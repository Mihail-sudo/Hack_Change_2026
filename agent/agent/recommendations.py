"""Проверка рекомендаций по ограничениям официальной базы."""

from agent.domain import B2B_PHOTO_SEGMENTS, isolated_region, merged_domain_slots

ALLOWED_PRODUCTS = {"askue_cloud", "commercial_losses", "meter_photo", "solar", "orem"}


def infer_recommendations(reply: str, slots: dict) -> list[dict]:
    text = reply.lower()
    reason = reply.split("?", 1)[0].strip()
    inferred = []
    power = slots.get("power_kw")
    task = (slots.get("task") or "").lower()
    if power is not None and power >= 750 and (any(word in text for word in ("орэм", "оптовый рынок", "оптового рынка", "оптовом рынке")) or any(word in task for word in ("орэм", "оптов"))):
        inferred.append({"product_id": "orem", "reason": reason, "configuration": None})
    if "платформа" in text and any(word in text for word in ("подходит", "поможет", "позволяет", "рекоменд", "поддерживает", "помогает", "показывает", "анализирует", "работает", "используется")):
        inferred.append({"product_id": "askue_cloud", "reason": reason, "configuration": None})
    if "коммерческих потерь" in text and "подходит" in text and "не подходит" not in text:
        inferred.append({"product_id": "commercial_losses", "reason": reason, "configuration": None})
    if "потер" in (slots.get("task") or "").lower() and any(word in text for word in ("проверк", "система", "анализ", "приоритет")):
        inferred.append({"product_id": "commercial_losses", "reason": reason, "configuration": None})
    if ("фото" in text or "фотограф" in text) and "показан" in text and any(word in text for word in ("можно", "подходит", "позволяет", "распознав", "дополняет", "закрывает", "использовать")):
        inferred.append({"product_id": "meter_photo", "reason": reason, "configuration": None})
    if any(word in text for word in ("солнечн", "сэс")) and any(word in text for word in ("подходит", "стоимость", "гибрид", "сетевая")):
        configuration = "hybrid" if "гибрид" in text else "grid"
        inferred.append({"product_id": "solar", "reason": reason, "configuration": configuration})
    return inferred


def _drop(item: dict, rule_id: str, clarification_slot: str | None = None) -> dict:
    return {**item, "_rule_id": rule_id, "_clarification_slot": clarification_slot}


def filter_recommendations(items: list, slots: dict) -> tuple[list[dict], list[dict]]:
    valid = []
    dropped = []
    domain = merged_domain_slots(slots)
    segment = domain["segment"]
    power = domain.get("power_kw")
    resource = (domain.get("resource_type") or "").lower()

    for item in items:
        if not isinstance(item, dict):
            continue
        product_id = item.get("product_id")
        reason = item.get("reason")
        configuration = item.get("configuration")
        if product_id not in ALLOWED_PRODUCTS or not isinstance(reason, str) or not reason.strip():
            dropped.append(_drop(item, "PRODUCT_UNKNOWN"))
            continue
        if product_id != "solar" and configuration is not None:
            dropped.append(_drop(item, "PRODUCT_CONFIGURATION"))
            continue

        rule = None
        clarification = None
        task = (slots.get("task") or "").lower()
        if product_id == "solar" and "потер" in task and not any(word in task for word in ("солнеч", "сэс", "панел")):
            rule = "SOLAR_TOPIC_MISMATCH"
        elif product_id == "commercial_losses" and any(word in task for word in ("солнеч", "сэс", "панел")) and "потер" not in task:
            rule = "LOSSES_TOPIC_MISMATCH"
        if product_id == "orem":
            if domain.get("current_market_participation") is True:
                rule = "OREM_ALREADY_PARTICIPANT"
            elif domain.get("power_unit_invalid") is True or power is None:
                rule, clarification = "OREM_POWER_UNKNOWN", "power_kw"
            elif power < 750:
                rule = "OREM_BELOW_750"
            elif not domain.get("region"):
                rule, clarification = "OREM_REGION_REQUIRED", "region"
            elif isolated_region(domain.get("region")):
                rule = "OREM_ISOLATED_REGION"
            elif segment != "industry":
                rule = "OREM_SEGMENT"
        elif product_id == "commercial_losses":
            if segment == "energy_sales":
                if domain.get("has_grid_assets") is not True:
                    rule = "LOSSES_GRID_ASSETS_REQUIRED"
                    clarification = "has_grid_assets" if domain.get("has_grid_assets") is None else None
            elif segment != "grid":
                rule = "LOSSES_SEGMENT"
        elif product_id == "solar":
            if segment in {"private_house", "apartment_building"}:
                rule = "SOLAR_SEGMENT"
            elif power is not None and power < 15:
                rule = "SOLAR_BELOW_15"
            elif power is not None and power > 500:
                rule = "SOLAR_INDIVIDUAL_REQUIRED"
            if rule is None:
                if configuration not in {"grid", "hybrid"}:
                    context = f"{reason} {slots.get('task') or ''}".lower()
                    if "гибрид" in context:
                        configuration = "hybrid"
                    elif "сетев" in context:
                        configuration = "grid"
                if configuration not in {"grid", "hybrid"}:
                    rule, clarification = "SOLAR_CONFIGURATION_REQUIRED", "solar_goal"
                elif slots.get("autonomy_required") is True and configuration != "hybrid":
                    rule = "SOLAR_GRID_NO_AUTONOMY"
        elif product_id == "meter_photo":
            if segment not in B2B_PHOTO_SEGMENTS:
                rule, clarification = "PHOTO_B2B_REQUIRED", "organization_type"
            elif resource in {"heat", "gas"}:
                rule = "PHOTO_RESOURCE_CUSTOM"
        elif product_id == "askue_cloud" and resource == "water":
            rule = "ASKUE_WATER_NOT_READY"

        if rule:
            dropped.append(_drop(item, rule, clarification))
            continue
        valid.append({
            "product_id": product_id,
            "reason": reason.strip(),
            "configuration": configuration if product_id == "solar" else None,
        })
    return valid, dropped


def fallback_recommendation_reply(valid: list[dict], dropped: list[dict], slots: dict) -> str:
    if valid:
        reasons = "; ".join(item["reason"] for item in valid)
        return f"По вашей задаче можно рассмотреть следующее: {reasons}. Точную конфигурацию определим по данным объекта."
    rule_ids = {item.get("_rule_id") for item in dropped if isinstance(item, dict)}
    if "OREM_BELOW_750" in rule_ids:
        return "При присоединённой мощности ниже 750 кВт выход на оптовый рынок невозможен."
    if "OREM_POWER_UNKNOWN" in rule_ids:
        return "Какая у вас присоединённая мощность в кВт?"
    if "OREM_REGION_REQUIRED" in rule_ids:
        return "В каком регионе находится объект?"
    if "OREM_ISOLATED_REGION" in rule_ids:
        return "В этом регионе услуга выхода на оптовый рынок не предлагается: оптовый рынок там не функционирует."
    if "OREM_SEGMENT" in rule_ids:
        return "Выход на оптовый рынок рассматривается для предприятий с производственной нагрузкой, а не только по показателю мощности."
    if "OREM_ALREADY_PARTICIPANT" in rule_ids:
        return "Если предприятие уже участвует в оптовом рынке, повторный выход не требуется. Можно обсудить независимый учёт и оценку смены схемы."
    if "LOSSES_GRID_ASSETS_REQUIRED" in rule_ids:
        return "Есть ли у вашей энергосбытовой компании сетевые организации на балансе?"
    if "LOSSES_SEGMENT" in rule_ids:
        return "Поиск коммерческих потерь предназначен для электросетевых организаций. Для контроля собственного потребления предприятия используется облачная платформа учёта."
    if "SOLAR_GRID_NO_AUTONOMY" in rule_ids:
        return "Для автономного питания нужна гибридная солнечная станция с накопителями. Сетевая станция отключается вместе с внешней сетью."
    if "SOLAR_SEGMENT" in rule_ids:
        return "Солнечные проекты EnergyTool ориентированы на бизнес. Для жилого дома такой типовой коммерческий проект не предлагается."
    if "SOLAR_BELOW_15" in rule_ids:
        return "Типовой диапазон солнечных проектов — 15–500 кВт. Для мощности меньше 15 кВт типовой проект не предлагается."
    if "SOLAR_INDIVIDUAL_REQUIRED" in rule_ids:
        return "При мощности больше 500 кВт требуется индивидуальный проект, а не типовое решение."
    if "PHOTO_B2B_REQUIRED" in rule_ids:
        return "Распознавание показаний по фотографии — B2B-решение для организаций. Напрямую через МТС частному абоненту такая передача недоступна; показание попадает в коммерческий учёт только после верификации."
    if "PHOTO_RESOURCE_CUSTOM" in rule_ids:
        return "Для тепла и газа распознавание показаний по фотографии возможно только как отдельная доработка, а не готовая функция."
    if "ASKUE_WATER_NOT_READY" in rule_ids:
        return "Для воды в базе подтверждено распознавание показаний по фотографии, а не готовая функция облачной платформы учёта."
    return "Уточните, пожалуйста, тип вашей организации."
