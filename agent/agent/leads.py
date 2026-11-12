"""Формирование заявки менеджеру без дополнительного вызова LLM."""

from agent.state import contacts_complete, merge_slots, new_state


def _segment(value: str | None) -> str:
    text = (value or "").lower()
    if "снт" in text or "товариществ" in text:
        return "snt"
    if "энергосбыт" in text or "гарантирующ" in text:
        return "energy_sales"
    if "сетев" in text:
        return "grid"
    if "водоканал" in text:
        return "vodokanal"
    if "управляющ" in text or "тсж" in text or "жкх" in text:
        return "uk"
    if any(word in text for word in ("кафе", "магазин", "офис", "бизнес", "ретейл", "склад")):
        return "business"
    if "производ" in text or "промыш" in text or "завод" in text:
        return "industry"
    return "other"


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
    if not contacts_complete(slots):
        raise ValueError("Для заявки нужны ФИО, телефон, компания и согласие на обработку персональных данных")

    history = state.get("history") or []
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
        "segment": _segment(slots.get("organization_type")),
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
