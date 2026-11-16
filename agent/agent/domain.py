"""Общие нормализованные признаки и доменные правила EnergyTool."""

import re

SEGMENTS = {
    "grid", "energy_sales", "industry", "retail", "business", "uk", "snt",
    "rso", "vodokanal", "private_house", "apartment_building", "other",
}
ISOLATED_REGIONS = {"камчатка", "магадан", "сахалин", "чукотка"}
B2B_PHOTO_SEGMENTS = {
    "grid", "energy_sales", "industry", "retail", "business", "uk", "snt",
    "rso", "vodokanal",
}
POWER_RE = re.compile(r"(?<![\w.])(\d+(?:[.,]\d+)?)\s*(мвт|квт)(?![\w·])", re.IGNORECASE)
INVALID_POWER_UNIT_RE = re.compile(r"(?:квт\s*[·*]\s*ч|мвт\s*[·*]\s*ч|кв\s*·?\s*а|мв\s*·?\s*а|квт\s*-\s*ч)", re.IGNORECASE)
CONSENT_RE = re.compile(
    r"(?:соглас\w+|даю\s+согласие|подтверждаю\s+согласие)[^.!?]*(?:персональн|контактн|обработк)",
    re.IGNORECASE,
)
CONSENT_REVOCATION_RE = re.compile(
    r"(?:отзыв\w*\s+согласи|не\s+соглас\w+|запрещ\w*)[^.!?]*(?:персональн|контактн|обработк)?",
    re.IGNORECASE,
)


def normalize_segment(value: str | None) -> str:
    text = (value or "").lower().replace("ё", "е")
    if not text.strip():
        return "other"
    if text in SEGMENTS:
        return text
    if any(word in text for word in ("частный абонент", "частный дом", "физическое лицо", "для дома")):
        return "private_house"
    if "многоквартирн" in text:
        return "apartment_building"
    if any(word in text for word in ("сетевой ретейл", "сетевой бизнес", "сеть магазин")):
        return "retail"
    if any(word in text for word in ("энергосбыт", "гарантирующ", "сбытовая компан")):
        return "energy_sales"
    if any(word in text for word in ("ресурсоснабжа", "рсо")):
        return "rso"
    if "водоканал" in text:
        return "vodokanal"
    if any(word in text for word in ("электросетев", "сетевая организац", "сетевые организации", "территориальн")) and "ретейл" not in text:
        return "grid"
    if "снт" in text or "товариществ" in text:
        return "snt"
    if re.search(r"\bук\b", text) or any(word in text for word in ("управляющ", "тсж", "жкх")):
        return "uk"
    if any(word in text for word in ("производ", "промыш", "завод", "фабрик")):
        return "industry"
    if any(word in text for word in ("магазин", "ретейл", "общепит", "кафе", "ресторан")):
        return "retail"
    if any(word in text for word in ("офис", "бизнес", "склад", "предприят", "компани", "организац")):
        return "business"
    return "other"


def normalize_grid_assets(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).lower().replace("ё", "е").strip()
    if text in {"true", "да", "есть", "имеются", "1"}:
        return True
    if text in {"false", "нет", "отсутствуют", "0"}:
        return False
    if re.search(r"(?:нет|без|отсутств\w*)[^.!?]*сет", text):
        return False
    if "сет" in text and any(word in text for word in ("есть", "име", "на балансе", "входят")):
        return True
    return None


def isolated_region(region: str | None) -> bool:
    text = (region or "").lower().replace("ё", "е")
    return any(name in text for name in ISOLATED_REGIONS)


def infer_slots_from_text(text: str) -> dict:
    normalized = (text or "").lower().replace("ё", "е")
    slots = {
        "segment": normalize_segment(normalized),
        "has_grid_assets": normalize_grid_assets(normalized),
        "power_kw": None,
        "power_unit_invalid": False,
        "region": None,
        "autonomy_required": None,
        "resource_type": None,
        "current_market_participation": None,
    }
    power = POWER_RE.search(normalized)
    if power:
        value = float(power.group(1).replace(",", "."))
        slots["power_kw"] = value * 1000 if power.group(2).lower() == "мвт" else value
    elif INVALID_POWER_UNIT_RE.search(normalized):
        slots["power_unit_invalid"] = True
    for region in sorted(ISOLATED_REGIONS):
        if region in normalized:
            slots["region"] = region
            break
    if slots["region"] is None and "москва" in normalized:
        slots["region"] = "Москва"
    if re.search(r"не\s+нуж\w*\s+(?:резерв|автоном)|без\s+резерва|резерв\w*\s+не\s+(?:нуж|требуется)|автономия\s+не\s+нуж", normalized):
        slots["autonomy_required"] = False
    elif any(word in normalized for word in ("при отключ", "автоном", "резерв", "без внешней сети")):
        slots["autonomy_required"] = True
    if "уже участвуем" in normalized or "уже работаем на оптовом рынке" in normalized:
        slots["current_market_participation"] = True
    if "тепл" in normalized:
        slots["resource_type"] = "heat"
    elif "газ" in normalized:
        slots["resource_type"] = "gas"
    elif "вод" in normalized:
        slots["resource_type"] = "water"
    elif any(word in normalized for word in ("электр", "счетчик", "показан")):
        slots["resource_type"] = "electricity"
    return slots


def merged_domain_slots(slots: dict, text: str = "") -> dict:
    merged = dict(slots)
    if text:
        inferred = infer_slots_from_text(text)
        for name, value in inferred.items():
            if name in {"autonomy_required", "power_unit_invalid", "current_market_participation"} and value is True:
                merged[name] = True
            elif merged.get(name) is None and value is not None:
                merged[name] = value
    segment = normalize_segment(merged.get("segment"))
    organization_segment = normalize_segment(merged.get("organization_type"))
    if segment == "other" and organization_segment != "other":
        segment = organization_segment
    merged["segment"] = segment
    merged["has_grid_assets"] = normalize_grid_assets(merged.get("has_grid_assets"))
    resource_aliases = {
        "электроэнергия": "electricity", "электричество": "electricity",
        "вода": "water", "тепло": "heat", "газ": "gas",
    }
    resource = (merged.get("resource_type") or "").lower()
    merged["resource_type"] = resource_aliases.get(resource, resource or None)
    if merged.get("autonomy_required") is False and not re.search(r"не\s+нуж\w*\s+(?:резерв|автоном)|без\s+резерва|резерв\s+не\s+нуж|автономия\s+не\s+нуж", text.lower()):
        merged["autonomy_required"] = None
    if merged.get("consent_pd") is False and merged.get("consent_revoked") is not True:
        merged["consent_pd"] = None
    return merged


def explicit_consent(message: str) -> bool:
    return bool(CONSENT_RE.search(message or "")) and not bool(CONSENT_REVOCATION_RE.search(message or ""))


def revoked_consent(message: str) -> bool:
    return bool(CONSENT_REVOCATION_RE.search(message or ""))


def consent_message_is_valid(message: str) -> bool:
    text = (message or "").strip()
    return explicit_consent(text) and len(text) <= 1000
