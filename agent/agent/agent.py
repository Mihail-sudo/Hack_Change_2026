"""Диалоговый агент EnergyTool с поиском по базе и формированием заявки."""

import json
import logging
import re
from functools import lru_cache
from pathlib import Path

from agent.catalog import search_catalog
from agent.dialogue import RESPONSE_FORMAT, AgentResponseError, parse_response
from agent.domain import (
    consent_message_is_valid,
    merged_domain_slots,
    revoked_consent,
)
from agent.guardrails import apply_required_answer_rules, safe_fallback_answer, validate_result
from agent.leads import build_lead, fallback_brief
from agent.llm import LLMError, call_llm
from agent.recommendations import fallback_recommendation_reply, filter_recommendations, infer_recommendations
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
        return f"{prefix}, подтвердите в форме согласие на обработку персональных данных."
    if len(labels) == 1:
        fields = labels[0]
    elif len(labels) == 2:
        fields = " и ".join(labels)
    else:
        fields = f"{', '.join(labels[:-1])} и {labels[-1]}"
    request = f"{prefix}, укажите {fields} в форме."
    if slots.get("consent_pd") is not True:
        request += " Согласие на обработку переданных контактных данных подтверждается отдельно."
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


def _helpful_reply(recommended: list[dict], slots: dict) -> str:
    if recommended:
        names = [PRODUCT_NAMES[item["product_id"]] for item in recommended]
        reply = f"Для вашей задачи можно рассмотреть: {' и '.join(names)}."
        product_id = recommended[0]["product_id"]
        if product_id == "orem" and not slots.get("power_kw"):
            return f"{reply} Какая у вас присоединённая мощность в кВт?"
        if product_id == "orem" and not slots.get("region"):
            return f"{reply} В каком регионе находится объект?"
        if product_id == "commercial_losses" and slots.get("has_grid_assets") is None:
            return f"{reply} Есть ли у вашей компании сетевые организации на балансе?"
        return reply
    if not slots.get("organization_type"):
        return "Подскажите, какая у вас организация?"
    if not slots.get("task"):
        return "Какую задачу вы хотите решить?"
    if "снт" in slots["organization_type"].lower() and not slots.get("metering_setup"):
        return "Как вы сейчас снимаете показания?"
    return "Уточните, пожалуйста, один ключевой параметр вашего объекта."


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


def _fallback(state: dict, query: str) -> dict:
    reply = apply_required_answer_rules(
        query,
        "Извините, сейчас не получается продолжить из-за технической ошибки. Контактные данные не требуются. Попробуйте повторить вопрос позже.",
    )
    slots = merged_domain_slots(state.get("slots") or {}, query)
    recommended, _ = filter_recommendations(infer_recommendations(reply, slots), slots)
    return {
        "reply": reply,
        "state": state,
        "sources": [],
        "recommended": recommended,
        "action": {"type": "clarify", "manager_brief": None},
        "actions": [],
        "done": False,
    }


def _apply_explicit_user_actions(slots: dict, text: str, human_request: bool, form_requested: bool) -> dict:
    updated = dict(slots)
    if revoked_consent(text):
        updated.update({"consent_pd": False, "consent_evidence": None, "consent_revoked": True})
    if CONTACT_REFUSAL_RE.search(text):
        updated.update({
            "contact_refused": True,
            "contact_refusal_evidence": text,
            "consent_pd": False,
            "consent_evidence": None,
        })
    if human_request or form_requested:
        updated["contact_refused"] = False
        updated["contact_refusal_evidence"] = None
    if consent_message_is_valid(text):
        updated.update({
            "consent_pd": True,
            "consent_evidence": text,
            "consent_revoked": False,
            "contact_refused": False,
            "contact_refusal_evidence": None,
        })
    return updated


def _repair_response(messages: list[dict], parsed: dict, dropped: list[dict]) -> dict:
    rule_ids = sorted({item.get("_rule_id") for item in dropped if item.get("_rule_id")})
    instruction = (
        "Исправь только нарушения правил с идентификаторами " + ", ".join(rule_ids) +
        ". Для REQUIRED_FACT_COVERAGE проверь, все ли необходимые для полного ответа факты, числа, "
        "единицы, ограничения и оговорки присутствуют в ответе; восстанови только относящиеся к вопросу "
        "сведения из контекста и один полезный следующий шаг. Для ОРЭМ различай 750 кВт и 20 МВт, "
        "для проекта больше 500 кВт назови индивидуальную оценку специалистом, для SIM-карт не требуй "
        "замену только из-за оператора при совместимых приборах. Сохрани все независимые корректные факты, "
        "слоты и следующий шаг. Не сокращай ответ ради краткости и не добавляй новые сведения. "
        "Если рекомендация недопустима, удали её и дай безопасное объяснение или один необходимый "
        "уточняющий вопрос. Верни тот же JSON-формат.\n\nИсходный JSON:\n" +
        json.dumps(parsed, ensure_ascii=False)
    )
    content = call_llm(
        [*messages, {"role": "user", "content": instruction}],
        response_format=RESPONSE_FORMAT,
        temperature=0,
    )
    return parse_response(content)


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

    human_request = bool(HUMAN_REQUEST_RE.search(text))
    form_requested = bool(FORM_REQUEST_RE.search(text))
    if revoked_consent(text):
        slots = _apply_explicit_user_actions(current["slots"], text, False, False)
        history = [*current["history"], {"role": "user", "content": text}]
        reply = "Согласие отозвано. Новая заявка и передача контактных данных не будут выполнены."
        new_state = {
            **current,
            "history": [*history, {"role": "assistant", "content": reply}],
            "slots": slots,
            "recommended": [],
            "done": False,
            "stage": "answer",
        }
        return {
            "reply": reply,
            "state": new_state,
            "sources": [],
            "recommended": [],
            "action": {"type": "answer", "manager_brief": None},
            "actions": [],
            "done": False,
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
    try:
        catalog = search_catalog(query)
        sources = _sources(catalog)
        messages = [
            {"role": "system", "content": _system_prompt(catalog, system_prompt)},
            *visible_history,
        ]
        content = call_llm(messages, response_format=RESPONSE_FORMAT, temperature=0.2)
        parsed = parse_response(content)
    except (LLMError, AgentResponseError, RuntimeError) as exc:
        logger.warning("Запасной ответ вместо технической ошибки: %s", exc)
        return _fallback(current, query)

    slots = merge_slots(current["slots"], parsed["slots"])
    slots = merged_domain_slots(slots, text)
    slots = _apply_explicit_user_actions(slots, text, human_request, form_requested)
    action_type = parsed["action"]
    reply = parsed["reply"]
    suggested = parsed["recommended"] or infer_recommendations(reply, slots)
    recommended, dropped = filter_recommendations(suggested, slots)
    brief = parsed.get("manager_brief") or current["manager_brief"]

    needs_review = bool(dropped)
    review_rules = dropped or [{"_rule_id": "REQUIRED_FACT_COVERAGE"}] if needs_review else []
    if review_rules:
        try:
            repaired = _repair_response(messages, parsed, review_rules)
            repaired_slots = merge_slots(slots, repaired["slots"])
            repaired_slots = _apply_explicit_user_actions(repaired_slots, text, human_request, form_requested)
            repaired_recommended = repaired["recommended"] or infer_recommendations(repaired["reply"], repaired_slots)
            second_valid, second_dropped = filter_recommendations(repaired_recommended, repaired_slots)
            if not second_dropped:
                parsed = repaired
                slots = repaired_slots
                recommended = second_valid
                dropped = []
                reply = repaired["reply"]
                action_type = repaired["action"]
                brief = repaired.get("manager_brief") or brief
        except (LLMError, AgentResponseError, RuntimeError) as exc:
            logger.warning("Контролируемое исправление рекомендации не удалось: %s", exc)
    if dropped:
        rule_ids = {item.get("_rule_id") for item in dropped}
        logger.info("Рекомендации отклонены правилами: %s", sorted(rule_ids))
        if rule_ids == {"SOLAR_CONFIGURATION_REQUIRED"} or (rule_ids <= {"ASKUE_WATER_NOT_READY", "PHOTO_B2B_REQUIRED"} and not any(word in text.lower() for word in ("частн", "напрямую"))):
            pass
        elif not recommended:
            reply = fallback_recommendation_reply(recommended, dropped, slots)
            brief = fallback_brief(slots)
            if action_type in {"answer", "show_form"}:
                action_type = "clarify"
        else:
            pass

    contact_refusal = bool(CONTACT_REFUSAL_RE.search(text))
    human_count = current["human_request_count"] + 1 if human_request else 0
    allow_form = (
        slots.get("contact_refused") is not True
        and action_type != "out_of_scope"
        and (human_request or form_requested or (action_type == "show_form" and _form_ready(slots)))
    )

    if contacts_complete(slots, history):
        action_type = "handover"
    elif slots.get("consent_revoked") is True:
        action_type = "answer"
        recommended = []
    elif contact_refusal or (slots.get("contact_refused") is True and not allow_form):
        if contact_refusal:
            reply = "Понял. Контактные данные не запрашиваются. Могу продолжить консультацию в чате."
        if action_type in {"show_form", "handover"}:
            action_type = "answer" if recommended else "clarify"
    elif allow_form:
        action_type = "show_form"
        if human_request:
            reply = _contacts_request(slots, operator=True)
        elif not _has_contact_request(reply, slots):
            reply = f"{reply}\n\n{_contacts_request(slots)}"
    elif human_request or action_type in {"show_form", "handover"}:
        action_type = "answer" if recommended else "clarify"
        reply = _helpful_reply(recommended, slots)

    reply = apply_required_answer_rules(query, reply)
    additional, _ = filter_recommendations(infer_recommendations(reply, slots), slots)
    for item in additional:
        if item["product_id"] not in {existing["product_id"] for existing in recommended}:
            recommended.append(item)
    form_shown = current["form_shown"] or action_type in {"show_form", "handover"}
    if action_type in {"show_form", "handover"}:
        brief = brief or fallback_brief(slots)
    violations = validate_result(reply, slots, recommended, {"type": action_type}, history)
    if violations:
        logger.warning("Ответ заблокирован доменными правилами: %s", [item["rule_id"] for item in violations])
        reply = safe_fallback_answer(query)
        action_type = "clarify"
        recommended = []
        brief = None
        form_shown = current["form_shown"]

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
        "action": {"type": action_type, "manager_brief": brief if action_type in {"show_form", "handover"} else None},
        "actions": actions,
        "done": done,
    }
