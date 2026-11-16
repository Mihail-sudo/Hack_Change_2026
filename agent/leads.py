"""Формирование заявки менеджеру без дополнительного вызова LLM."""

from agent.domain import consent_message_is_valid, normalize_segment
from agent.state import contacts_complete, merge_slots, new_state


def _segment(value: str | None) -> str:
    return normalize_segment(value)


def fallback_brief(slots: dict) -> str:
    organization = slots.get("organization_type") or slots.get("company") or "Клиент"
    task = slots.get("task") or "задача требует уточнения специалистом"
    return f"{organization}. Задача: {task}. Контакты и условия проекта уточняет менеджер."


def build_lead(state: dict | None, contact: dict, source: str = "form") -> dict:
    state = state or new_state()
    slots = dict(state.get("slots") or {})
    incoming = dict(contact)
    if "name" in incoming and "full_name" not in incoming:
        incoming["full_name"] = incoming["name"]
    slots = merge_slots(slots, incoming)
    history = list(state.get("history") or [])
    if source == "form" and incoming.get("consent_pd") is True:
        consent_text = incoming.get("consent_text", "").strip()
        if consent_message_is_valid(consent_text):
            slots["consent_evidence"] = consent_text
            slots["consent_revoked"] = False
            history.append({"role": "user", "content": consent_text})
    if not contacts_complete(slots, history):
        raise ValueError("Для заявки нужны ФИО, телефон, компания и доказанное действующее согласие")

    summary = state.get("manager_brief") or fallback_brief(slots)
    return {
        "lead_id": None,
        "created_at": None,
        "session_id": contact.get("session_id"),
        "source": source,
        "contact": {
            "name": slots["full_name"],
            "company": slots["company"],
            "role": contact.get("role"),
            "phone": slots["phone"],
            "email": contact.get("email"),
            "preferred_channel": "телефон",
        },
        "consent_pd": True,
        "segment": _segment(slots.get("segment") or slots.get("organization_type")),
        "problem": slots.get("task") or "",
        "slots": slots,
        "recommended": list(state.get("recommended") or []),
        "summary": summary,
        "tags": [],
        "priority": "normal",
        "transcript": [
            {"role": "client" if item.get("role") == "user" else "bot", "text": item.get("content", "")}
            for item in history
            if item.get("role") in {"user", "assistant"}
        ],
    }
