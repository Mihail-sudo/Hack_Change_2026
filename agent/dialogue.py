"""Схема и проверка единого ответа диалоговой модели."""

import json

from agent.state import SLOT_TYPES, valid_slot

ACTION_TYPES = {"answer", "clarify", "show_form", "out_of_scope", "handover"}
JSON_TYPES = {str: ["string", "null"], bool: ["boolean", "null"], (int, float): ["number", "null"]}
RECOMMENDATION_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "product_id": {
                "type": "string",
                "enum": ["askue_cloud", "commercial_losses", "meter_photo", "solar", "orem"],
            },
            "reason": {"type": "string"},
            "configuration": {"type": ["string", "null"], "enum": ["grid", "hybrid", None]},
        },
        "required": ["product_id", "reason", "configuration"],
        "additionalProperties": False,
    },
}
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "dialogue_response",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "reply": {"type": "string"},
                "action": {"type": "string", "enum": sorted(ACTION_TYPES)},
                "manager_brief": {"type": ["string", "null"]},
                "recommended": RECOMMENDATION_SCHEMA,
                "slots": {
                    "type": "object",
                    "properties": {
                        name: {"type": JSON_TYPES[expected]} for name, expected in SLOT_TYPES.items()
                    },
                    "required": list(SLOT_TYPES),
                    "additionalProperties": False,
                },
            },
            "required": ["reply", "action", "manager_brief", "recommended", "slots"],
            "additionalProperties": False,
        },
    },
}


class AgentResponseError(ValueError):
    pass


def parse_response(content: str) -> dict:
    text = content.strip()
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        result = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AgentResponseError("Модель вернула невалидный JSON") from exc
    if not isinstance(result, dict):
        raise AgentResponseError("Ответ модели не является объектом")
    if not isinstance(result.get("reply"), str) or not result["reply"].strip():
        raise AgentResponseError("Пустой текст ответа")
    if result.get("action") not in ACTION_TYPES:
        raise AgentResponseError("Неизвестное действие модели")
    if result.get("manager_brief") is not None and not isinstance(result["manager_brief"], str):
        raise AgentResponseError("Некорректное резюме менеджеру")
    if not isinstance(result.get("recommended"), list):
        raise AgentResponseError("Некорректные рекомендации")
    for item in result["recommended"]:
        if not isinstance(item, dict) or not isinstance(item.get("reason"), str):
            raise AgentResponseError("Некорректная рекомендация")
    slots = result.get("slots")
    if not isinstance(slots, dict):
        raise AgentResponseError("Слоты отсутствуют")
    for name in SLOT_TYPES:
        value = slots.get(name)
        if value is not None and not valid_slot(name, value):
            raise AgentResponseError(f"Некорректный слот: {name}")
    result["reply"] = result["reply"].strip()
    return result
