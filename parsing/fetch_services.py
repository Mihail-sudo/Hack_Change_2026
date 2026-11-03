"""
Выгрузка текста страниц услуг EnergyTool (https://energytool.mts.ru) для RAG.

Почему нужен браузер: сайт — одностраничное приложение (React). Обычный requests.get
вернёт пустой HTML: весь текст зашит в JS-бандл и появляется только после выполнения скриптов.
Поэтому страницу открывает настоящий браузер (Playwright), а мы забираем уже отрисованный текст.

Отдельная сложность — FAQ: ответы спрятаны в аккордеонах и открываются по одному
(открыл следующий — предыдущий закрылся). Поэтому кликаем вопросы по очереди и сразу
забираем текст ответа.

Установка:
    pip install playwright
    playwright install chromium

Запуск:
    python fetch_services.py

Результат:
    data/services/services_raw.json — по каждой странице: url, title, основной текст, список вопрос/ответ
    data/services/<slug>.md         — то же в markdown, по файлу на страницу (удобно резать на чанки для RAG)

Скрипт открывает ~12 страниц по одному разу с паузами. Не запускай в цикле.
"""

import json
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

SITE = "https://energytool.mts.ru"
PAGES = [
    "/commercial_losses",
    "/askue",
    "/askue/opportunities",
    "/askue/price",
    "/askue/snt",
    "/solar-panels",
    "/solar-panels/meter-for-a-solar-panel-owner",
    "/mining",
    "/vodokanal",
    "/metering-devices",
    "/metering-devices/automatization",
    "/termokontur",
    "/orem",
]
OUT = Path(__file__).resolve().parent.parent / "data" / "services"

# Блоки, которые повторяются на многих страницах и только засоряют базу знаний
CROSS_SELL_START = "Подключите другие наши продукты"
FAQ_START = "Вопросы и ответы"


def clean(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{2,}", "\n", text).strip()


def main_text(page) -> str:
    root = page.query_selector("main") or page.query_selector("body")
    text = clean(root.inner_text())
    # Вырезаем блок перекрёстных продаж и FAQ (FAQ собираем отдельно)
    a = text.find(CROSS_SELL_START)
    if a >= 0:
        text = text[:a]
    b = text.find(FAQ_START)
    if b >= 0:
        text = text[:b]
    return text.strip()


def collect_faq(page) -> list[dict]:
    """Кликает вопросы FAQ по одному и забирает ответ сразу после клика."""
    root = page.query_selector("main") or page.query_selector("body")
    full = root.inner_text()
    if FAQ_START not in full:
        return []

    # Вопросы: короткие листовые элементы, текст которых заканчивается на «?»,
    # и только те, что идут после заголовка «Вопросы и ответы» (выше бывают риторические вопросы).
    faq_part = full[full.find(FAQ_START):]
    candidates = page.locator("main *, body *").filter(has_text=re.compile(r"\?\s*$"))
    questions = []
    for el in candidates.element_handles():
        if el.evaluate("e => e.children.length") != 0:
            continue
        q = el.inner_text().strip()
        if q.endswith("?") and len(q) < 200 and q in faq_part and q not in [x[0] for x in questions]:
            questions.append((q, el))

    q_texts = [q for q, _ in questions]
    result = []
    for q, el in questions:
        try:
            el.click()
        except Exception:
            el.evaluate("e => (e.closest('button,[role=button],summary') || e.parentElement || e).click()")
        page.wait_for_timeout(500)
        text = root.inner_text()
        idx = text.rfind(q)
        answer = ""
        if idx >= 0:
            rest = text[idx + len(q):]
            cut = len(rest)
            for other in q_texts:
                if other != q:
                    j = rest.find(other)
                    if 0 <= j < cut:
                        cut = j
            answer = clean(rest[:cut]).replace("\n", " ")
        if answer:
            result.append({"q": q, "a": answer})
    return result


def slug(path: str) -> str:
    return path.strip("/").replace("/", "__") or "index"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pages = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(locale="ru-RU")
        for path in PAGES:
            url = SITE + path
            print("→", url)
            page.goto(url, wait_until="networkidle", timeout=60_000)
            page.wait_for_timeout(1500)  # SPA дорисовывает блоки после загрузки
            item = {
                "url": url,
                "title": page.title(),
                "text": main_text(page),
                "faq": collect_faq(page),
            }
            pages.append(item)

            md = [f"# {item['title']}", "", f"Источник: {url}", "", item["text"]]
            if item["faq"]:
                md += ["", "## Вопросы и ответы", ""]
                for f in item["faq"]:
                    md += [f"**{f['q']}**", f["a"], ""]
            (OUT / f"{slug(path)}.md").write_text("\n".join(md), encoding="utf-8")
            time.sleep(1)  # не нагружаем сайт
        browser.close()

    (OUT / "services_raw.json").write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8")
    total_faq = sum(len(x["faq"]) for x in pages)
    print(f"Готово: {len(pages)} страниц, {total_faq} вопросов в FAQ. Файлы в {OUT.resolve()}")


if __name__ == "__main__":
    main()
