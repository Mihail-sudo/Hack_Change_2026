"""Диалоговый агент EnergyTool с поиском по базе и формированием заявки."""

import logging
import re
from functools import lru_cache
from pathlib import Path

from agent.catalog import search_catalog
from agent.dialogue import RESPONSE_FORMAT, AgentResponseError, parse_response
from agent.leads import build_lead, fallback_brief
from agent.llm import LLMError, call_llm
from agent.recommendations import fallback_recommendation_reply, filter_recommendations
from agent.state import contacts_complete, merge_slots, normalize_state

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "system.md"
DIALOGUE_PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "dialogue.md"
MAX_HISTORY_MESSAGES = 40
HUMAN_REQUEST_RE = re.compile(
    r"(?:дай|позови(?:те)?|нужен|хочу|переключ\w*|свяж\w*|соедин\w*)[^.!?]*(?:человек|менеджер|оператор)|живого человека|живого менеджера",
    re.IGNORECASE,
)
CONTACT_REFUSAL_RE = re.compile(
    r"(?:не\s+(?:буду|хочу|надо|нужно)|без|откаж\w*)[^.!?]*(?:контакт|персональн|телефон)|не\s+оставл\w*\s+контакт",
    re.IGNORECASE,
)


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


def _has_contact_request(reply: str, slots: dict) -> bool:
    text = reply.lower()
    if slots.get("consent_pd") is not True and "соглас" not in text:
        return False
    for name, label in (("full_name", "фио"), ("phone", "телефон"), ("company", "компани")):
        if not slots.get(name) and label not in text:
            return False
    return True


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


def _fallback(state: dict) -> dict:
    state = {**state, "form_shown": True, "stage": "contacts"}
    return {
        "reply": "Извините, сейчас не получается ответить. Оставьте, пожалуйста, телефон, и менеджер свяжется с вами.",
        "state": state,
        "sources": [],
        "recommended": state["recommended"],
        "action": {"type": "show_form", "manager_brief": state["manager_brief"]},
        "actions": [],
        "done": False,
    }


def respond(message: str, state: dict | None, *, system_prompt: str = "") -> dict:
    """Ответить клиенту и вернуть состояние, источники и логическое действие."""
    text = (message or "").strip()
    current = normalize_state(state)

    if not text:
        return {
            "reply": "Напишите, пожалуйста, ваш вопрос.",
            "state": current,
            "sources": [],
            "recommended": current["recommended"],
            "action": {"type": "clarify", "manager_brief": None},
            "actions": [],
            "done": current["done"],
        }
    if current["done"]:
        return {
            "reply": "Заявка уже передана менеджеру. Для нового обращения начните новый диалог.",
            "state": current,
            "sources": [],
            "recommended": current["recommended"],
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
    try:
        content = call_llm(messages, response_format=RESPONSE_FORMAT, temperature=0.2)
        parsed = parse_response(content)
    except (LLMError, AgentResponseError) as exc:
        logger.warning("Запасной ответ вместо ошибки модели: %s", exc)
        return _fallback(current)

    slots = merge_slots(current["slots"], parsed["slots"])
    recommended, dropped = filter_recommendations(parsed["recommended"], slots)
    action_type = parsed["action"]
    reply = parsed["reply"]
    brief = parsed.get("manager_brief") or current["manager_brief"]
    if dropped:
        reply = fallback_recommendation_reply(recommended, dropped, slots)
        brief = fallback_brief(slots)
        if not recommended and action_type in {"answer", "show_form"}:
            action_type = "clarify"

    if contacts_complete(slots):
        action_type = "handover"
    elif HUMAN_REQUEST_RE.search(text):
        action_type = "show_form"
        reply = f"Передам вашу заявку менеджеру.\n\n{_contacts_request(slots)}"
    elif CONTACT_REFUSAL_RE.search(text):
        action_type = "answer"
        reply = "Понял, контакты не требуются. Продолжу консультацию без передачи заявки менеджеру."
    else:
        if action_type == "handover":
            action_type = "show_form"
        if action_type == "show_form" and not _has_contact_request(reply, slots):
            reply = f"{reply}\n\n{_contacts_request(slots)}"

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
        "recommended": recommended,
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
        "recommended": recommended,
        "action": {"type": action_type, "manager_brief": brief if form_shown else None},
        "actions": actions,
        "done": done,
    }
