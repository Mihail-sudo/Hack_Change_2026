"""Сериализуемое состояние диалога и безопасное слияние слотов."""

SLOT_TYPES = {
    "organization_type": str,
    "task": str,
    "power_kw": (int, float),
    "monthly_consumption_kwh": (int, float),
    "metering_setup": str,
    "price_category": str,
    "region": str,
    "site_details": str,
    "autonomy_required": bool,
    "resource_type": str,
    "full_name": str,
    "phone": str,
    "company": str,
    "consent_pd": bool,
}


def new_state() -> dict:
    return {
        "history": [],
        "slots": {name: None for name in SLOT_TYPES},
        "recommended": [],
        "human_request_count": 0,
        "stage": "discovery",
        "form_shown": False,
        "manager_brief": None,
        "done": False,
    }


def normalize_state(state: dict | None) -> dict:
    normalized = new_state()
    if not state:
        return normalized
    normalized["history"] = list(state.get("history") or [])
    normalized["slots"].update({
        name: value for name, value in (state.get("slots") or {}).items() if name in SLOT_TYPES
    })
    normalized["recommended"] = list(state.get("recommended") or [])
    normalized["human_request_count"] = int(state.get("human_request_count", 0) or 0)
    normalized["stage"] = state.get("stage") or "discovery"
    normalized["form_shown"] = bool(state.get("form_shown", False))
    normalized["manager_brief"] = state.get("manager_brief")
    normalized["done"] = bool(state.get("done", False))
    return normalized


def valid_slot(name: str, value) -> bool:
    expected = SLOT_TYPES[name]
    if expected is bool:
        return isinstance(value, bool)
    if expected is str:
        return isinstance(value, str) and bool(value.strip())
    return isinstance(value, expected) and not isinstance(value, bool)


def merge_slots(known: dict, extracted: dict) -> dict:
    merged = dict(known)
    for name in SLOT_TYPES:
        value = extracted.get(name)
        if value is not None and valid_slot(name, value):
            merged[name] = value.strip() if isinstance(value, str) else value
    return merged


def contacts_complete(slots: dict) -> bool:
    return all(slots.get(name) for name in ("full_name", "phone", "company")) and slots.get("consent_pd") is True
