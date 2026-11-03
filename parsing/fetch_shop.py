"""
Выгрузка каталога магазина EnergyTool (https://energytool.mts.ru/shop) через его же API
и подготовка базы знаний для LLM.

Как это нашли: сайт написан на JS, и HTML страницы пустой. В DevTools -> Network -> Fetch/XHR
видно, что витрина берёт товары одним GET-запросом к https://lk.energytool.mts.ru/api/shop,
который отдаёт JSON-массив. Авторизация для него не нужна.

Запуск:
    pip install requests
    python fetch_shop.py

Результат:
    data/shop/shop_raw.json      — ответ API как есть (на случай, если понадобятся поля, которые мы выкинули)
    data/shop/shop_clean.json    — нормализованный список: цены, «по запросу», скрытые товары
    data/shop/shop_kb.md         — текст для системного промпта / RAG, по одному блоку на товар

Скрипт делает ОДИН запрос. Не запускай его в цикле: это чужой продакшен-сервер.
"""

import json
from pathlib import Path

import requests

API_URL = "https://lk.energytool.mts.ru/api/shop"
SITE = "https://energytool.mts.ru"
OUT = Path(__file__).resolve().parent.parent / "data" / "shop"


def fetch() -> list[dict]:
    resp = requests.get(
        API_URL,
        headers={"User-Agent": "hackchange-energytool-kb/0.1", "Accept": "application/json"},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError(f"Ожидался список товаров, пришло: {type(data).__name__}")
    return data


def clean_text(s: str | None) -> str | None:
    if not s:
        return None
    # в описаниях встречаются хвостовые переносы и пробелы
    return " ".join(s.split())


def normalize(item: dict) -> dict:
    price = item.get("price")
    page = item.get("redirect") or None
    if page and not page.startswith("http"):
        page = f"{SITE}/{page.lstrip('/')}"

    docs = item.get("docs") or {}
    promotions = [p.get("promotion_bubble") for p in (item.get("promotions") or []) if p.get("promotion_bubble")]

    return {
        "id": item.get("id"),
        "name": clean_text(item.get("name")),
        "category": clean_text(item.get("category")),
        "subtype": clean_text(item.get("type")),           # «Трехфазный», «по абонентской модели» и т.п.
        "connectivity": clean_text(item.get("conn_type")),  # NB-IoT / GSM/GPRS / пусто
        # -1 в API означает «По запросу»: превращаем в null, чтобы модель не назвала цену -1 ₽
        "price_rub": price if isinstance(price, (int, float)) and price >= 0 else None,
        "price_type": item.get("price_type"),               # Фиксированная / Ежемесячная / По запросу
        "promotions": promotions,
        "hidden": bool(item.get("hide_flag")),              # true — товар скрыт на витрине
        "page": page,
        "description": clean_text(item.get("desc")),
        "docs": [{"title": t, "url": u} for t, u in docs.items()],
    }


def price_line(p: dict) -> str:
    if p["price_rub"] is None:
        return "цена по запросу (рассчитывает менеджер)"
    if p["price_type"] == "Ежемесячная":
        # За что именно ежемесячная плата (точка учёта, объект?) — на сайте не сказано, со сноской «*».
        # Не додумываем: пусть модель так и говорит, а детали уточняет менеджер.
        return f"от {p['price_rub']:,} ₽ в месяц (единица тарификации на сайте не указана)".replace(",", " ")
    return f"{p['price_rub']:,} ₽".replace(",", " ")


def to_markdown(items: list[dict]) -> str:
    lines = [
        "# Каталог магазина EnergyTool",
        "",
        f"Источник: {SITE}/shop. Цены с сайта, окончательную стоимость считает менеджер.",
        "",
    ]
    by_cat: dict[str, list[dict]] = {}
    for p in items:
        if p["hidden"]:
            continue
        by_cat.setdefault(p["category"] or "Прочее", []).append(p)

    for cat, prods in by_cat.items():
        lines += [f"## {cat}", ""]
        for p in prods:
            title = p["name"] + (f" ({p['subtype']})" if p["subtype"] else "")
            lines.append(f"### {title}")
            lines.append(f"- id: {p['id']}")
            lines.append(f"- Цена: {price_line(p)}")
            if p["connectivity"]:
                lines.append(f"- Связь: {p['connectivity']}")
            if p["promotions"]:
                lines.append(f"- Акция: {', '.join(p['promotions'])}")
            if p["page"]:
                lines.append(f"- Страница: {p['page']}")
            if p["description"]:
                lines.append(f"- Описание: {p['description']}")
            for d in p["docs"]:
                lines.append(f"- Документ: [{d['title']}]({d['url']})")
            lines.append("")
    return "\n".join(lines)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    raw = fetch()
    (OUT / "shop_raw.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    items = [normalize(i) for i in raw]
    (OUT / "shop_clean.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "shop_kb.md").write_text(to_markdown(items), encoding="utf-8")

    visible = sum(not i["hidden"] for i in items)
    print(f"Товаров: {len(items)}, видимых на витрине: {visible}. Файлы в {OUT.resolve()}")


if __name__ == "__main__":
    main()
