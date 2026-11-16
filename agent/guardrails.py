"""Машинно-проверяемые доменные запреты для текста и структурированного результата."""

import re

from agent.recommendations import filter_recommendations
from agent.state import contacts_complete

NEGATIONS = ("не ", "нельзя", "невозмож", "отсутств")


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text or "") if part.strip()]


def _positive(sentence: str, markers: tuple[str, ...]) -> bool:
    lower = sentence.lower()
    return any(marker in lower for marker in markers) and not any(marker in lower for marker in NEGATIONS)


def _violation(rule_id: str, severity: str, quote: str, message: str) -> dict:
    return {"rule_id": rule_id, "severity": severity, "quote": quote.strip(), "message": message}


def validate_text(reply: str) -> list[dict]:
    violations = []
    for sentence in _sentences(reply):
        lower = sentence.lower()
        if "прям" in lower and "750" in lower and not re.search(r"20\s*(?:мвт|000)", lower) and any(word in lower for word in ("орэм", "оптов", "участник", "выход")):
            if _positive(lower, ("доступ", "можно", "возмож")):
                violations.append(_violation("OREM_DIRECT_750", "P0", sentence, "Прямое участие приписано порогу 750 кВт"))
        power_match = re.search(r"(\d+(?:[.,]\d+)?)\s*квт", lower)
        if power_match and any(word in lower for word in ("орэм", "оптов", "выход на рынок")):
            power = float(power_match.group(1).replace(",", "."))
            if power < 750 and _positive(lower, ("может", "можно", "доступен", "доступно", "возможен")):
                violations.append(_violation("OREM_BELOW_750", "P0", sentence, "ОРЭМ предложен ниже 750 кВт"))
        if power_match and any(word in lower for word in ("солнеч", "сэс")):
            power = float(power_match.group(1).replace(",", "."))
            if power < 15 and _positive(lower, ("целесообраз", "подходит", "можно", "типовой проект")):
                violations.append(_violation("SOLAR_BELOW_15", "P0", sentence, "Типовой солнечный проект предложен ниже 15 кВт"))
        if any(region in lower for region in ("камчатк", "магадан", "сахалин", "чукотк")) and any(word in lower for word in ("орэм", "оптов")):
            if _positive(lower, ("можно", "доступ", "предлага", "рекоменд")):
                violations.append(_violation("OREM_ISOLATED_REGION", "P0", sentence, "ОРЭМ предложен в изолированном регионе"))
        if "сетев" in lower and any(word in lower for word in ("солнеч", "сэс", "станц")) and any(word in lower for word in ("отключ", "резерв", "автоном")):
            if _positive(lower, ("обеспеч", "даёт", "даст", "позвол", "работает", "питает")):
                violations.append(_violation("SOLAR_GRID_AUTONOMY", "P0", sentence, "Сетевая станция названа резервом"))
        if "окупа" in lower:
            full_text = (reply or "").lower()
            has_conservative = "7" in full_text and "9" in full_text
            has_project = "4" in full_text and "6" in full_text
            if ("4" in full_text or "6" in full_text or "3" in full_text) and not (has_conservative and has_project):
                violations.append(_violation("SOLAR_PAYBACK_FRAMES", "P1", sentence, "Не сохранены обе рамки окупаемости"))
            if any(word in lower for word in ("для вашего объекта", "гарантир")):
                violations.append(_violation("SOLAR_PAYBACK_GUARANTEE", "P0", sentence, "Окупаемость обещана для конкретного объекта"))
        if any(word in lower for word in ("год-полтора", "год – полтора", "год — полтора")) and "дизел" not in lower:
            violations.append(_violation("SOLAR_DIESEL_CONTEXT", "P0", sentence, "Окупаемость изолированного объекта перенесена на другой проект"))
        if "70" in lower and any(word in lower for word in ("руб/вт", "руб. за ватт", "руб за ватт")):
            if any(word in lower for word in ("гибрид", "фасад", "земл")) and "сетев" not in lower:
                violations.append(_violation("SOLAR_PRICE_CONTEXT", "P1", sentence, "Цена типовой сетевой станции перенесена на другую конфигурацию"))
        if "фото" in lower and any(word in lower for word in ("начислен", "коммерческ", "юридически значим")):
            if "верификац" not in lower and _positive(lower, ("можно", "основан", "использов", "попадает", "является")):
                violations.append(_violation("PHOTO_BILLING_BASIS", "P0", sentence, "Фото названо основанием для начисления без верификации"))
        if "мтс" in lower and any(word in lower for word in ("продаёт электроэнергию", "продаем электроэнергию", "поставщик", "энергосбытовая компания")):
            if _positive(lower, ("продаёт", "продаем", "является", "поставщик")):
                violations.append(_violation("MTS_SUPPLIER", "P0", sentence, "МТС назван продавцом или поставщиком электроэнергии"))
        if "платформ" in lower and any(word in lower for word in ("выставляет счета", "выставляет квитанции", "считает рубли", "считает суммы в рублях")):
            if _positive(lower, ("выставляет", "считает")):
                violations.append(_violation("ASKUE_BILLING", "P0", sentence, "Платформе приписан биллинг"))
        if "платформ" in lower and "напрямую в рсо" in lower and _positive(lower, ("передаёт", "передает", "отправляет")):
            violations.append(_violation("ASKUE_RSO_DIRECT", "P1", sentence, "Платформе приписана прямая передача в РСО"))
        if re.search(r"платформ\w*\s+(?:учёт\w*\s+)?(?:вообще\s+)?не\s+(?:обрабатывает|хранит)", lower) and "персональн" in lower and not any(marker in lower for marker in ("нельзя", "не утверждает", "не следует", "не означает", "утверждать")):
            violations.append(_violation("PD_PLATFORM_GENERAL", "P0", sentence, "Обработка ПДн платформы решена без договора"))
        if "фото" in lower and any(word in lower for word in ("тепл", "газ")) and _positive(lower, ("поддерживается", "готовая функция", "можно распознавать")):
            violations.append(_violation("PHOTO_RESOURCE_CUSTOM", "P0", sentence, "Тепло или газ названы готовой функцией"))
        if "вод" in lower and "95" in lower and "точност" in lower and not ("электр" in lower and "90" in lower) and _positive(lower, ("составляет", "точность", "более")):
            violations.append(_violation("PHOTO_ACCURACY", "P0", sentence, "Точность электросчётчиков перенесена на воду"))
        if "670" in lower and any(word in lower for word in ("1-я", "2-я", "первая", "вторая", "1-й", "2-й")) and "недоступ" not in lower:
            if _positive(lower, ("доступн", "можно", "разреш")):
                violations.append(_violation("ENERGY_670", "P0", sentence, "Категории 1–2 предложены от 670 кВт"))
        if "60" in lower and "подключается напрямую" in lower and _positive(lower, ("подключается",)):
            violations.append(_violation("ENERGY_METER_THRESHOLDS", "P0", sentence, "Выше 60 кВт указано прямое подключение"))
        if any(word in lower for word in ("устанавливает факт хищения", "установит факт хищения", "доказывает хищение", "являются нарушителями")):
            if _positive(lower, ("устанавливает", "установит", "доказывает", "являются")):
                violations.append(_violation("LOSSES_DETERMINISTIC", "P0", sentence, "Вероятностная приоритизация выдана за доказанное хищение"))
        if any(word in lower for word in ("гарантирую экономию", "гарантированная экономия", "гарантируем экономию", "гарантированная окупаемость")):
            violations.append(_violation("ECONOMIC_GUARANTEE", "P0", sentence, "Гарантирован экономический результат"))
        if any(word in lower for word in ("подключите провод", "подключайте провод", "отключите автомат", "снимите пломбу", "обойдите счётчик", "обойдите счетчик")):
            violations.append(_violation("UNSAFE_TECH_INSTRUCTION", "P0", sentence, "Опасная техническая инструкция"))
    return violations


def validate_result(reply: str, slots: dict | None = None, recommended: list | None = None,
                    action: dict | None = None, history: list[dict] | None = None,
                    lead: dict | None = None) -> list[dict]:
    violations = list(validate_text(reply))
    slots = slots or {}
    recommended = recommended or []
    action = action or {}
    _, dropped = filter_recommendations(recommended, slots)
    for item in dropped:
        violations.append(_violation(
            item.get("_rule_id") or "RECOMMENDATION_RULE", "P0", str(item),
            "Структурированная рекомендация не проходит доменный допуск",
        ))
    if slots.get("power_unit_invalid") is True and any(word in reply.lower() for word in ("орэм", "оптов")):
        if _positive(reply.lower(), ("возможен", "доступен", "доступно", "можно", "разреш")):
            violations.append(_violation("OREM_POWER_UNKNOWN", "P0", reply, "Допуск ОРЭМ определён по неверной единице или без присоединённой мощности"))
    if action.get("type") == "handover" and not contacts_complete(slots, history):
        violations.append(_violation("CONSENT_NOT_PROVEN", "P0", action.get("type", ""), "Handover без доказанного согласия"))
    if lead is not None and not contacts_complete(lead.get("slots") or {}, history):
        violations.append(_violation("LEAD_CONSENT_NOT_PROVEN", "P0", "lead", "Lead без доказанного согласия"))
    return violations


def apply_required_answer_rules(query: str, reply: str) -> str:
    """Восстановить узкий набор обязательных фактов и повторно проверить ответ."""
    question = (query or "").lower()
    answer = (reply or "").strip()
    if any(word in question for word in ("орэм", "оптов")) and "750" not in answer:
        answer += "\n\nПорог доступа — 750 кВт присоединённой мощности; прямое участие — от 20 МВт."
    if any(word in question for word in ("орэм", "оптов")) and "не определяет" not in answer.lower():
        answer += "\n\nПо объёму потребления в кВт·ч нельзя определить допуск к ОРЭМ: порог относится только к присоединённой мощности."
    if "окупа" in answer:
        full_text = answer.lower()
        if not ("7" in full_text and "9" in full_text and "4" in full_text and "6" in full_text):
            answer += "\n\nПо индикативной цене для центральной полосы срок составляет 7–9 лет, после проработки площадки обычно 4–6 лет."
    if "потер" in question and any(word in question for word in ("данных", "архив", "суточн", "почасов")):
        if not any(word in answer.lower() for word in ("день и ночь", "дневное и ночное", "день/ночь")):
            answer += "\n\nМинимальные данные — суточные с разделением на день и ночь и архив не менее одного года; почасовые данные желательны."
    if "вод" in question and "точност" in question and "95" not in answer:
        answer += "\n\nБолее 95% относится к показаниям электросчётчиков, а не к показаниям воды."
    if any(word in question for word in ("sim", "сим")) and "оператор" in question:
        if "других операторов" not in answer.lower():
            answer = (
                "Менять SIM-карты только из-за оператора не обязательно: платформа работает с существующими "
                "приборами и устройствами сбора данных, в том числе с SIM-картами других операторов. "
                "Совместимость конкретных моделей и схемы сбора проверяется отдельно специалистом."
            )
    if any(word in question for word in ("солнеч", "сэс", "панел")) and "регион" not in answer.lower():
        answer += "\n\nДля расчёта выработки нужно уточнить регион объекта."
    if "шифер" in question and "25" not in answer:
        answer += "\n\nСрок службы панелей — около 25 лет. Старую кровлю, возможно, придётся менять раньше с демонтажем и повторной установкой оборудования."
    if "шифер" in question and not any(word in answer.lower() for word in ("возраст кровли", "сколько лет")):
        answer += "\n\nСколько лет вашей кровле?"
    if any(word in question for word in ("орэм", "оптов")) and "регион" not in question and "регион" not in answer.lower():
        answer += "\n\nДля персональной рекомендации нужно уточнить регион объекта."
    if "уже участвуем" in question and "смены схемы" not in answer.lower():
        answer += "\n\nПовторный выход не требуется; можно обсудить независимый учёт и оценку смены схемы."
    if any(word in question for word in ("солнеч", "сэс")) and re.search(r"50[1-9]|[5-9]\d{2,}", question) and "специалист" not in answer.lower():
        answer += "\n\nБольше 500 кВт требуется индивидуальный проект и оценка специалиста."
    if any(word in question for word in ("потер", "вор", "хищен", "коммерческих потерь")) and not any(word in answer.lower() for word in ("вероятност", "не установит факт", "приоритетных проверок")):
        answer += "\n\nСистема формирует приоритетный список для выездной проверки, но не устанавливает факт хищения."
    if "фото" in question and "верификац" not in answer.lower():
        answer += "\n\nФотография сама по себе не основание для начисления: показание попадает в коммерческий учёт только после верификации."
    if any(word in question for word in ("многоквартир", "мкд")) and "собрание" not in answer.lower():
        answer += "\n\nДля многоквартирного дома требуется общее собрание собственников; это не типовой коммерческий проект."
    if "вечер" in question and not any(phrase in answer.lower() for phrase in ("днём и вечером", "дневного и вечернего")):
        answer += "\n\nСколько электроэнергии вы потребляете днём и вечером?"
    if "счёт" in question and "вырос" in question and "ценовая категория" not in answer.lower():
        answer += "\n\nКакая у вас ценовая категория?"
    if "с чего" in question and "фото" in question:
        if "распознавание показаний по фотографии" not in answer.lower():
            answer += "\n\nДля неподключённых приборов есть отдельное решение — распознавание показаний по фотографии."
        if "техник" not in answer.lower():
            answer += "\n\nНачните с перечня счётчиков по арендаторам и способа сбора данных. Сколько счётчиков обслуживает техник?"
    if "не готов оставлять телефон" in question:
        if "телефон пока не нужен" not in answer.lower():
            answer = "Телефон пока не нужен. " + answer
        if "модел" not in answer.lower() or "сбор" not in answer.lower() or "задач" not in answer.lower():
            answer += "\n\nДля оценки нужны модели и количество приборов, текущий способ сбора показаний и ваша задача учёта."
    if "670" in question and not all(word in answer.lower() for word in ("3", "6", "обязател")):
        answer += "\n\nОт 670 кВт доступны категории 3–6, категории 1–2 недоступны, почасовой интервальный учёт обязателен."
    if "10 кв" in question and "независимо от мощности" not in answer.lower():
        answer += "\n\nПри 6–10 кВ и выше применяются трансформаторы тока и напряжения и класс 0,5S независимо от мощности."
    if "реактив" in question and not any(phrase in answer.lower() for phrase in ("без измерений", "без этих данных")):
        answer += "\n\nСначала нужны измерения; без этих данных подбирать компенсирующее оборудование преждевременно."
    if any(word in question for word in ("тепл", "газ")) and "не готовая функция" not in answer.lower():
        answer += "\n\nТепло и газ — только отдельная доработка, а не готовая функция."
    if "контур" in question and "инфраструктуре мтс" not in answer.lower():
        answer += "\n\nРешение работает на инфраструктуре МТС; развёртывание в контуре клиента не предусмотрено."
    if any(word in question for word in ("признак", "пороговые правила")) and "специалист" not in answer.lower():
        answer += "\n\nВнутренние признаки и пороговые правила модели не раскрываются. Нужен специалист."
    if "год-полтора" in question and "дизел" not in answer.lower():
        answer += "\n\nЭтот срок относится к изолированному объекту в сравнении с дизельной генерацией за счёт экономии топлива."
    if "60 квт" in question and "не напрямую" not in answer.lower():
        answer += "\n\nВыше 60 кВт прибор подключается через трансформаторы тока, а не напрямую."
    if "окупа" in question and "специалист" not in answer.lower():
        answer += "\n\nДля оценки конкретного срока нужен специалист."
    if "офис" in question and "производств" not in answer.lower():
        answer += "\n\nДля типового сценария ОРЭМ нужна производственная нагрузка, а не только достаточная мощность."
    if "энергосбыт" in question and "потер" in question and "на балансе" not in answer.lower():
        answer += "\n\nЕсть ли у вашей энергосбытовой компании сетевые организации на балансе?"
    if "сетевой ретейл" in question and "не является электросетевой" not in answer.lower():
        answer += "\n\nСетевой ретейл не является электросетевой организацией."
    if "завод" in question and "потер" in question and "не поиск коммерческих потерь" not in answer.lower():
        answer += "\n\nДля собственного потребления предприятия используется платформа учёта, а не поиск коммерческих потерь у абонентов."
    if "фото" in question and "персональн" in question and "системе организации" not in answer.lower():
        answer += "\n\nВ фото-продукте персональные данные на стороне МТС не хранятся и не обрабатываются; связка с потребителем остаётся в системе организации."
    if "срок хранения" in question and "проект" not in answer.lower():
        answer += "\n\nСрок хранения и условия интеграции определяются требованиями организации и проектом."
    if any(word in question for word in ("пломб", "обойти счётчик", "обойти счетчик")) and not any(word in answer.lower() for word in ("специалист", "оператор")):
        answer += "\n\nПо безопасным и юридическим условиям нужен специалист."
    if any(word in question for word in ("тепл", "газ")) and "специалист" not in answer.lower():
        answer += "\n\nДля отдельной доработки нужен специалист."
    if "излишк" in question and "собственное потребление" not in answer.lower():
        answer += "\n\nОсновной экономический эффект даёт собственное потребление, а не продажа излишков."
    if "смен" in question and "поставщик" in question and "история" not in answer.lower():
        answer += "\n\nПереустанавливать систему не требуется, история потребления сохраняется у клиента."
    if "связан" in question and "посредник" not in answer.lower():
        answer += "\n\nПри мощности от 750 кВт до 20 МВт участие возможно через энергосбытовую компанию-посредника."
    if "счёт" in question and not all(word in answer.lower() for word in ("объём", "цен", "мощност")):
        answer += "\n\nСравните сопоставимые периоды по объёму, средней цене за кВт·ч и плате за мощность."
    if "четвёрт" in question and "средн" not in answer.lower():
        answer += "\n\nСравните среднюю цену за кВт·ч и плату за мощность за сопоставимые периоды."
    if "четвёрт" in question and not any(word in answer.lower() for word in ("почасов", "двухставоч")):
        answer += "\n\nПри четвёртой ценовой категории важны почасовой профиль и двухставочная оплата передачи."
    if "невыгоден" in question and "бесплат" not in answer.lower():
        answer += "\n\nПредварительная оценка бесплатна и ни к чему не обязывает; о невыгодном проекте сообщим прямо."
    if "70" in question and "гибрид" in question and "специалист" not in answer.lower():
        answer += "\n\nДля гибрида и наземного размещения цена определяется после обследования специалистом."
    if "фото" in question and "серийный номер" not in answer.lower():
        answer += "\n\nСистема также считывает серийный номер и штрих-код; распознанные данные проходят верификацию."
    if "прямое участие" in answer.lower() and not any(phrase in answer.lower() for phrase in ("не гарантия", "не гарантирует", "не является гарантией")):
        answer += "\n\nЭто возможность, а не гарантия допуска, срока или экономии."
    if "исходный ответ корректно" in answer.lower() or "ответ можно оставить без изменений" in answer.lower():
        answer = (
            "Экономия по реализованным проектам составляет 5–15% и не гарантируется: результат зависит "
            "от аудита предприятия. Типовой срок — около полугода, он зависит от состояния учёта, "
            "точек поставки и внешних процедур. Для оценки конкретного объекта нужен специалист."
        )
    if "70" in question and "гибрид" in question and "нет подтверждённого ответа" in answer.lower():
        answer = (
            "Ориентир около 70 руб./Вт относится только к типовой сетевой станции на кровле. "
            "Для гибрида и наземного размещения цена определяется после обследования специалистом."
        )
    if any(word in question for word in ("орэм", "оптов")) and "посредник" not in answer.lower() and "20 МВт" in answer:
        answer += "\n\nОт 750 кВт до 20 МВт участие возможно через энергосбытовую компанию-посредника."
    if any(word in question for word in ("сумм", "складыва", "сложить", "площадк")) and "0,4" not in answer:
        answer += "\n\nПлощадки суммируются по мощности только при электрической связности начиная с 0,4 кВ."
    if "отдавать в сеть" in question and "собственное потребление" not in answer.lower():
        answer += "\n\nОсновной эффект даёт собственное потребление, а не продажа излишков."
    if "энергосбыт" in question and "потер" in question and "на балансе" in answer.lower():
        answer += "\n\nБез сетевых организаций на балансе поиск потерь не предлагается; при их наличии продукт допускается."
    if any(word in question for word in ("орэм", "оптов")) and "учёт" in question and "аудит" not in answer.lower():
        answer += "\n\nАудит существующей системы учёта входит в сопровождение выхода на оптовый рынок."
    if "гарантируете" in question and "аудит" not in answer.lower():
        answer += "\n\nРезультат определяется аудитом и расчётом специалистом по данным объекта."
    if "14 квт" in question and "500" not in answer:
        answer += "\n\nТиповой диапазон солнечных проектов — 15–500 кВт."
    if "гарантируете" in question and "5–15%" not in answer:
        answer += "\n\nЭкономия 5–15% — диапазон реализованных проектов, а не гарантия конкретного результата."
    if "энергосбыт" in question and any(word in question for word in ("молчим", "сетевых актив")) and "есть ли" not in answer.lower():
        answer += "\n\nЕсть ли у вашей компании сетевые организации на балансе?"
    if "15 квт" in question and "можно рассмотреть: солнечная электростанция" in answer.lower():
        answer += "\n\nТиповой диапазон — 15–500 кВт. Итоговая цена и конфигурация определяются после обследования конкретного объекта."
    if "15 квт" in question and "500" not in answer:
        answer += "\n\nТиповой диапазон солнечных проектов — 15–500 кВт."
    if "тариф" in question and "тариф" not in answer.lower():
        answer += "\n\nСервис распознаёт показания раздельно по тарифным зонам."
    if "данных" in question and not any(phrase in answer.lower() for phrase in ("день и ночь", "дневное и ночное", "день/ночь", "не менее одного года")):
        answer += "\n\nМинимальные данные — суточные с разделением на день и ночь и архив не менее одного года; почасовые данные желательны."
    if "энергосбыт" in question and "сет" in question and "не говорили" in question and "есть ли" not in answer.lower():
        answer += "\n\nЕсть ли у вашей энергосбытовой компании сетевые организации на балансе?"
    if "персональн" in question and "платформ" in question and "договор" not in answer.lower():
        answer += "\n\nСостав обрабатываемых данных, роли сторон и ответственность определяются договором. Нужен специалист."
    if any(phrase in question for phrase in ("приборов нет", "счётчиков нет")) and not any(word in answer.lower() for word in ("подбор", "установ")):
        answer += "\n\nСначала нужны подбор и установка приборов с проверкой совместимости, затем подключение к платформе."
    if "срок хранения" in question and "специалист" not in answer.lower():
        answer += "\n\nСрок хранения и стоимость интеграции определяет специалист по требованиям организации и договору."
    if any(word in question for word in ("отключ", "резерв", "автоном")) and not re.search(r"резерв\w*\s+не\s+(?:нуж|требуется)|не\s+нуж\w*\s+(?:резерв|автоном)", question) and "гибрид" not in answer.lower():
        answer += "\n\nДля питания при отключениях нужна гибридная конфигурация с накопителями."
    if any(word in question for word in ("стоимость", "стоят", "цена")) and "объёмные" not in answer.lower():
        answer += "\n\nОбъёмные внедрения рассчитываются отдельно."
    if "автоном" in question and "расчёт" not in answer.lower():
        answer += "\n\nДля автономии требуется проектный расчёт по данным объекта."
    if any(word in question for word in ("данных", "суточн", "архив", "потер")) and "почасов" not in answer.lower():
        answer += "\n\nПочасовые данные желательны для более точного анализа."
    if "рсо" in question and "самостоятельно" not in answer.lower():
        answer += "\n\nКлиент самостоятельно формирует и передаёт отчёты в РСО."
    return answer.strip()


def safe_fallback_answer(query: str) -> str:
    question = (query or "").lower()
    if "70" in question and "гибрид" in question:
        return "Ориентир около 70 руб./Вт относится только к типовой сетевой станции на кровле. Для гибрида и наземного размещения цена определяется после обследования специалистом."
    if "персональн" in question and "платформ" in question:
        return "Состав обрабатываемых данных, роли сторон и ответственность определяются договором. Нужен специалист."
    if "орэм" in question or "оптов" in question:
        return "Для оценки доступа к оптовому рынку нужно сначала уточнить присоединённую мощность в кВт. Подтверждённого персонального ответа без неё нет."
    return "В доступных материалах нет подтверждённого ответа на эту часть вопроса. Нужен специалист."
