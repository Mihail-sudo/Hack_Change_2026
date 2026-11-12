"""Диалоговый агент EnergyTool с поиском по базе и формированием заявки."""

import logging
import re
from functools import lru_cache
from pathlib import Path

from agent.catalog import search_catalog
from agent.dialogue import RESPONSE_FORMAT, parse_response
from agent.leads import build_lead, fallback_brief
from agent.llm import call_llm
from agent.state import contacts_complete, merge_slots, normalize_state

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "system.md"
DIALOGUE_PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "dialogue.md"
MAX_HISTORY_MESSAGES = 40
def _contacts_request(slots: dict) -> str:
    labels = [
        label for name, label in (("full_name", "ФИО"), ("phone", "телефон"), ("company", "название компании"))
        if not slots.get(name)
    ]
    if not labels:
        return "Чтобы передать заявку менеджеру, подтвердите согласие на обработку персональных данных."
    if len(labels) == 1:
        fields = labels[0]
    elif len(labels) == 2:
        fields = " и ".join(labels)
    else:
        fields = f"{', '.join(labels[:-1])} и {labels[-1]}"
    request = f"Чтобы передать заявку менеджеру, укажите {fields}."
    if slots.get("consent_pd") is not True:
        request += " Также подтвердите согласие на обработку персональных данных."
    return request


@lru_cache(maxsize=1)
def _prompt_template(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError(f"Пустой промпт: {path}")
    return text


def _system_prompt(catalog: str, custom_prompt: str = "") -> str:
    base = _prompt_template(SYSTEM_PROMPT_FILE)
    if "{catalog}" not in base:
        raise RuntimeError(f"В системном промпте нет места для каталога: {SYSTEM_PROMPT_FILE}")
    prompt = base.replace("{catalog}", catalog, 1)
    if custom_prompt.strip():
        prompt = f"{custom_prompt.strip()}\n\n{prompt}"
    return f"{prompt}\n\n{_prompt_template(DIALOGUE_PROMPT_FILE)}"


def _trim(history: list[dict]) -> list[dict]:
    if len(history) <= MAX_HISTORY_MESSAGES:
        return history
    tail = history[-MAX_HISTORY_MESSAGES:]
    while tail and tail[0]["role"] != "user":
        tail.pop(0)
    return tail or history[-MAX_HISTORY_MESSAGES:]


def _sources(catalog: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"(?m)^Источник: (.+)$", catalog)))


def respond(message: str, state: dict | None, *, system_prompt: str = "") -> dict:
    """Ответить клиенту и вернуть состояние, источники и логическое действие."""
    text = (message or "").strip()
    current = normalize_state(state)

    if not text:
        return {
            "reply": "Напишите, пожалуйста, ваш вопрос.",
            "state": current,
            "sources": [],
            "action": {"type": "clarify", "manager_brief": None},
            "actions": [],
            "done": current["done"],
        }
    if current["done"]:
        return {
            "reply": "Заявка уже передана менеджеру. Для нового обращения начните новый диалог.",
            "state": current,
            "sources": [],
            "action": {"type": "answer", "manager_brief": current["manager_brief"]},
            "actions": [],
            "done": True,
        }

    history = list(current["history"])
    history.append({"role": "user", "content": text})
    visible_history = _trim(history)
    query = "\n".join(item["content"] for item in visible_history[-6:])
    catalog = search_catalog(query)
    sources = _sources(catalog)
    messages = [
        {"role": "system", "content": _system_prompt(catalog, system_prompt)},
        *visible_history,
    ]
    parsed = parse_response(call_llm(messages, response_format=RESPONSE_FORMAT, temperature=0.2))

    slots = merge_slots(current["slots"], parsed["slots"])
    action_type = parsed["action"]
    reply = parsed["reply"]
    brief = parsed.get("manager_brief") or current["manager_brief"]
    if contacts_complete(slots):
        action_type = "handover"
    else:
        if action_type == "handover":
            action_type = "show_form"
        if action_type == "show_form":
            reply = _contacts_request(slots)

    form_shown = current["form_shown"] or action_type in {"show_form", "handover"}
    if action_type in {"show_form", "handover"}:
        brief = brief or fallback_brief(slots)
    stage = current["stage"]
    if action_type == "clarify":
        stage = "discovery"
    elif action_type == "answer":
        stage = "recommendation"
    elif action_type in {"show_form", "handover"}:
        stage = "contacts"

    done = action_type == "handover"
    if done:
        stage = "done"
    new_state = {
        "history": [*history, {"role": "assistant", "content": reply}],
        "slots": slots,
        "stage": stage,
        "form_shown": form_shown,
        "manager_brief": brief,
        "done": done,
    }
    actions = []
    if done:
        lead = build_lead(new_state, {}, source="chat")
        actions.append({"type": "handoff", "lead": lead})

    logger.info("ход диалога: действие %s, источников %d", action_type, len(sources))
    return {
        "reply": reply,
        "state": new_state,
        "sources": sources,
        "action": {"type": action_type, "manager_brief": brief if form_shown else None},
        "actions": actions,
        "done": done,
    }
