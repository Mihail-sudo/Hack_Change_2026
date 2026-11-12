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
FORM_REQUEST_RE = re.compile(
    r"(?:остав\w*\s+(?:заявк|контакт)|заполн\w*\s+форм|покаж\w*\s+форм|готов\w*\s+оставить)",
    re.IGNORECASE,
)
PRODUCT_NAMES = {
    "askue_cloud": "облачная платформа учёта",
    "commercial_losses": "поиск коммерческих потерь",
    "meter_photo": "распознавание показаний по фотографии",
    "solar": "солнечная электростанция",
    "orem": "сопровождение выхода на оптовый рынок",
}


def _contacts_request(slots: dict, *, operator: bool = False) -> str:
    labels = [
        label for name, label in (("full_name", "ФИО"), ("phone", "телефон"), ("company", "название компании"))
        if not slots.get(name)
    ]
    prefix = "Хорошо, чтобы оператор связался с вами напрямую" if operator else "Чтобы передать заявку менеджеру"
    if not labels:
        return f"{prefix}, подтвердите согласие на обработку персональных данных."
    if len(labels) == 1:
        fields = labels[0]
    elif len(labels) == 2:
        fields = " и ".join(labels)
    else:
        fields = f"{', '.join(labels[:-1])} и {labels[-1]}"
    request = f"{prefix}, укажите {fields}."
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


def _form_ready(slots: dict) -> bool:
    if not slots.get("organization_type") or not slots.get("task"):
        return False
    if "снт" in slots["organization_type"].lower() and not slots.get("metering_setup"):
        return False
    return True


def _helpful_reply(recommended: list[dict], slots: dict, human_count: int = 0) -> str:
    if recommended:
        names = [PRODUCT_NAMES[item["product_id"]] for item in recommended]
        if human_count == 1:
            return f"Могу передать диалог менеджеру, но сначала попробую помочь сам. Для вашей задачи подходит {' и '.join(names)}. Подскажите, есть ли в домах приборы учёта?"
        if human_count == 2:
            return "Понимаю, что удобнее поговорить с человеком. Платформа как раз решает вашу задачу, а менеджер потом сможет рассчитать конфигурацию. Если приборов нет, начнём с их подбора и установки. Попробуем разобраться дальше или всё же перейти к контактам?"
        reply = f"Для вашей задачи подходит {' и '.join(names)}."
    elif human_count == 1:
        return "Могу помочь разобраться с учётом и подобрать решение. Расскажите, какая у вас организация и какая задача?"
    elif human_count == 2:
        reply = "Понимаю, что удобнее сразу поговорить с человеком. Я всё же постараюсь помочь разобраться в задаче и подготовить предметный вопрос менеджеру."
    else:
        reply = "Я могу помочь подобрать решение EnergyTool по вашей задаче."
    if not slots.get("organization_type"):
        return f"{reply} Подскажите, какая у вас организация?"
    if not slots.get("task"):
        return f"{reply} Какую задачу вы хотите решить?"
    if "снт" in slots["organization_type"].lower() and not slots.get("metering_setup"):
        return f"{reply} Есть ли в домах приборы учёта и как вы сейчас снимаете показания?"
    return f"{reply} Какие детали объекта нужно учесть при подборе?"


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

    human_request = bool(HUMAN_REQUEST_RE.search(text))
    contact_refusal = bool(CONTACT_REFUSAL_RE.search(text))
    human_count = current["human_request_count"] + 1 if human_request else 0
    form_requested = bool(FORM_REQUEST_RE.search(text))
    allow_form = (
        human_count >= 3
        or form_requested
        or (not human_request and action_type == "show_form" and _form_ready(slots))
    )

    if contacts_complete(slots):
        action_type = "handover"
    elif contact_refusal:
        human_count = 0
        action_type = "answer"
        reply = "Понял. Без контактных данных оператор не сможет связаться с вами. Могу продолжить консультацию в чате, а если передумаете — помогу оформить заявку."
    elif allow_form:
        action_type = "show_form"
        repeat_form = human_count > 3 and current["form_shown"] and slots == current["slots"]
        if repeat_form:
            reply = "Без контактных данных оператор не сможет связаться с вами. Заполните, пожалуйста, форму выше."
        elif human_request and human_count >= 3:
            reply = _contacts_request(slots, operator=True)
        elif human_request:
            reply = "Понимаю, вам удобнее поговорить с человеком."
        if not repeat_form and not _has_contact_request(reply, slots):
            reply = f"{reply}\n\n{_contacts_request(slots)}"
    elif human_request or action_type in {"show_form", "handover"}:
        action_type = "answer" if recommended else "clarify"
        reply = _helpful_reply(recommended, slots, human_count)

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
        "human_request_count": human_count,
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
