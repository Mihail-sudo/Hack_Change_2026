"""Проверка рекомендаций по ограничениям официальной базы."""

ALLOWED_PRODUCTS = {"askue_cloud", "commercial_losses", "meter_photo", "solar", "orem"}


def filter_recommendations(items: list, slots: dict) -> tuple[list[dict], list[dict]]:
    valid = []
    dropped = []
    organization = (slots.get("organization_type") or "").lower()
    power = slots.get("power_kw")
    resource = (slots.get("resource_type") or "").lower()

    for item in items:
        if not isinstance(item, dict):
            continue
        product_id = item.get("product_id")
        reason = item.get("reason")
        configuration = item.get("configuration")
        if product_id not in ALLOWED_PRODUCTS or not isinstance(reason, str) or not reason.strip():
            dropped.append(item)
            continue
        if product_id == "orem" and (power is None or power < 750):
            dropped.append(item)
            continue
        if product_id == "commercial_losses" and "сетев" not in organization:
            dropped.append(item)
            continue
        if product_id == "solar":
            if configuration not in {"grid", "hybrid"}:
                dropped.append(item)
                continue
            if slots.get("autonomy_required") is True and configuration != "hybrid":
                dropped.append(item)
                continue
        if product_id == "meter_photo" and any(word in resource for word in ("тепл", "газ")):
            dropped.append(item)
            continue
        valid.append({
            "product_id": product_id,
            "reason": reason.strip(),
            "configuration": configuration if product_id == "solar" else None,
        })
        if product_id != "solar" and configuration is not None:
            dropped.append(item)
    return valid, dropped


def fallback_recommendation_reply(valid: list[dict], dropped: list[dict], slots: dict) -> str:
    if valid:
        reasons = "; ".join(item["reason"] for item in valid)
        return f"По вашей задаче можно рассмотреть следующее: {reasons}. Точную конфигурацию определим по данным объекта."
    dropped_ids = {item.get("product_id") for item in dropped if isinstance(item, dict)}
    power = slots.get("power_kw")
    if "orem" in dropped_ids:
        if power is not None and power < 750:
            return "При присоединённой мощности ниже 750 кВт выход на оптовый рынок невозможен. Могу помочь подобрать другой способ снижения затрат."
        return "Чтобы понять, доступен ли выход на оптовый рынок, уточните присоединённую мощность предприятия в кВт."
    if "commercial_losses" in dropped_ids:
        return "Поиск коммерческих потерь предназначен для электросетевых организаций. Для контроля собственного потребления предприятия используется облачная платформа учёта."
    if "solar" in dropped_ids and slots.get("autonomy_required") is True:
        return "Для автономного питания нужна гибридная солнечная станция с накопителями. Сетевая станция не обеспечивает питание при отключении внешней сети."
    if "meter_photo" in dropped_ids:
        return "Для тепла и газа распознавание показаний по фотографии не является готовой функцией и требует отдельной оценки специалистом."
    return "Чтобы подобрать решение, уточните тип организации и задачу подробнее."
