"""Проверка recall поиска по 18 демо-вопросам независимо от генерации."""

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent.catalog import search_catalog
EXPECTED = {
    "1": (["20-products/23-solar.md"], ["запад-восток"]),
    "2": (["20-products/23-solar.md"], ["вертикальные"]),
    "3": (["20-products/23-solar.md"], ["наращив"]),
    "4": (["20-products/23-solar.md"], ["шифер", "25 лет"]),
    "5": (["20-products/22-askue.md"], ["Историческая схема"]),
    "6": (["20-products/22-askue.md"], ["по цехам"]),
    "7": (["20-products/22-askue.md"], ["ретейл"]),
    "8": (["20-products/25-meter-reading.md"], ["тарифная зона"]),
    "9": (["20-products/25-meter-reading.md"], ["год производства"]),
    "10": (["10-energy/14-tariffs.md"], ["категор"]),
    "11": (["10-energy/17-faq.md"], ["150 кВт"]),
    "12": (["20-products/21-orem.md"], ["аудит"]),
    "13": (["20-products/26-general.md"], ["бесплатный"]),
    "14": (["20-products/23-solar.md"], ["гибрид"]),
    "15": (["20-products/22-askue.md", "20-products/25-meter-reading.md"], ["фото"]),
    "16": (["20-products/24-losses.md"], ["приоритетных проверок"]),
    "17": (["10-energy/11-price-categories.md"], ["профиль"]),
    "18": (["20-products/22-askue.md"], ["модели"]),
}


def main() -> None:
    output = ROOT / "evals" / "results"
    output.mkdir(exist_ok=True)
    answers_path = ROOT / "evals" / "results" / "demo_comparison_bm25.json"
    answers = json.loads(answers_path.read_text(encoding="utf-8")) if answers_path.exists() else []
    scores = {item["id"]: item.get("judge_score") for item in answers}

    with (ROOT / "data" / "questions.csv").open(encoding="utf-8-sig", newline="") as file:
        questions = list(csv.DictReader(file))

    report = []
    for row in questions:
        expected_sources, keywords = EXPECTED[row["id"]]
        context = search_catalog(row["question"])
        sources = list(dict.fromkeys(re.findall(r"Источник: ([^\n]+)", context)))
        missing_sources = [source for source in expected_sources if source not in sources]
        missing_keywords = [word for word in keywords if word.lower() not in context.lower()]
        retrieval_ok = not missing_sources and not missing_keywords
        score = scores.get(row["id"])
        if not retrieval_ok:
            category = "поиск"
        elif score is not None and score < 3:
            category = "генерация"
        else:
            category = "ok"
        report.append({
            "id": row["id"],
            "question": row["question"],
            "expected_sources": expected_sources,
            "retrieved_sources": sources,
            "missing_sources": missing_sources,
            "missing_keywords": missing_keywords,
            "retrieval_ok": retrieval_ok,
            "judge_score": score,
            "category": category,
        })

    output.joinpath("retrieval_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# Recall поиска по 18 демо-вопросам",
        "",
        "| ID | Recall | Категория | Оценка | Недостающие источники | Недостающие слова |",
        "|---|---|---|---|---|---|",
    ]
    for item in report:
        lines.append(
            f"| {item['id']} | {'да' if item['retrieval_ok'] else 'нет'} | {item['category']} | "
            f"{item['judge_score']} | {', '.join(item['missing_sources']) or '—'} | "
            f"{', '.join(item['missing_keywords']) or '—'} |"
        )
    output.joinpath("retrieval_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    categories = Counter(item["category"] for item in report)
    print("Категории:", dict(categories))
    print(f"Recall: {categories['ok']}/{len(report)}")
    for item in report:
        if item["category"] != "ok":
            print(f"{item['id']}: {item['category']}; missing sources={item['missing_sources']}; keywords={item['missing_keywords']}")
    print(f"Отчёты: {output / 'retrieval_report.json'} и {output / 'retrieval_report.md'}")


if __name__ == "__main__":
    main()
