"""Двухраундовая pairwise-оценка ответов относительно локального baseline."""

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent.llm import call_llm

SCORES = {0.0, 0.25, 0.5, 0.75, 1.0}
JUDGE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "pairwise_judgement",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "score": {"type": "number", "enum": [0, 0.25, 0.5, 0.75, 1]},
                "reason": {"type": "string"},
            },
            "required": ["score", "reason"],
            "additionalProperties": False,
        },
    },
}


def read_questions(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != ["id", "question"]:
            raise ValueError(f"{path}: ожидаются ровно колонки id,question")
        rows = [{"id": str(row["id"]), "question": row["question"]} for row in reader]
    check_unique_ids(rows, path)
    return rows


def read_answers(path: Path) -> dict[str, str]:
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("items", []) if isinstance(payload, dict) else payload
        answers = []
        for row in rows:
            answer = row.get("answer", row.get("reply"))
            if answer is None:
                raise ValueError(f"{path}: у ответа с id={row.get('id')} нет поля answer или reply")
            answers.append({"id": str(row["id"]), "answer": answer})
    else:
        with path.open(encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            if reader.fieldnames != ["id", "answer"]:
                raise ValueError(f"{path}: ожидаются ровно колонки id,answer")
            answers = [{"id": str(row["id"]), "answer": row["answer"]} for row in reader]
    check_unique_ids(answers, path)
    return {row["id"]: row["answer"] for row in answers}


def check_unique_ids(rows: list[dict], path: Path) -> None:
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{path}: ID не должны повторяться")


def judge_round(question: str, golden: str, answer_a: str, answer_b: str, target: str) -> dict:
    prompt = f"""Ты — независимый судья ответов консультанта EnergyTool.
Сравни два ответа на один вопрос, ориентируясь на эталонный ответ. Оценивай фактическую
точность, полноту важных деталей и оговорок, конкретность и полезность следующего шага.
Не давай преимущества за длину или стиль. Снижай оценку за выдуманные факты и неверные выводы.

Оцени ответ {target} относительно другого ответа по шкале:
1.00 — ответ {target} значительно лучше;
0.75 — ответ {target} немного лучше;
0.50 — ответы сопоставимы;
0.25 — ответ {target} немного хуже;
0.00 — ответ {target} значительно хуже.

Верни JSON с числовым score и кратким reason на русском языке.

Вопрос:
{question}

Эталонный ответ:
{golden}

Ответ A:
{answer_a}

Ответ B:
{answer_b}
"""
    content = call_llm(
        [{"role": "user", "content": prompt}],
        response_format=JUDGE_FORMAT,
        temperature=0,
    )
    result = json.loads(content)
    score = float(result["score"])
    if score not in SCORES:
        raise ValueError(f"Судья вернул недопустимый score: {score}")
    return {"score": score, "reason": str(result["reason"]).strip()}


def evaluate_question(question: dict, golden: str, candidate: str, baseline: str) -> dict:
    item = {
        "id": question["id"],
        "question": question["question"],
        "golden": golden,
        "candidate": candidate,
        "baseline": baseline,
        "rounds": [],
        "score": None,
        "outcome": "error",
        "error": None,
    }
    specifications = [
        (1, baseline, candidate, "B"),
        (2, candidate, baseline, "A"),
    ]
    for number, answer_a, answer_b, target in specifications:
        round_result = {"round": number, "answer_a": "baseline" if number == 1 else "candidate"}
        try:
            round_result.update(judge_round(question["question"], golden, answer_a, answer_b, target))
        except Exception as exc:
            round_result["error"] = str(exc)
            item["error"] = f"Раунд {number}: {exc}"
            item["rounds"].append(round_result)
            return item
        item["rounds"].append(round_result)

    score = statistics.mean(round_result["score"] for round_result in item["rounds"])
    item["score"] = score
    item["outcome"] = "win" if score > 0.5 else "loss" if score < 0.5 else "tie"
    return item


def calculate_summary(items: list[dict]) -> dict:
    successful = [item for item in items if item["score"] is not None]
    wins = sum(item["outcome"] == "win" for item in successful)
    losses = sum(item["outcome"] == "loss" for item in successful)
    ties = sum(item["outcome"] == "tie" for item in successful)
    match_rate = statistics.mean(item["score"] for item in successful) if successful else 0.0
    win_rate = wins / (wins + losses) if wins + losses else 0.5
    return {
        "questions": len(items),
        "judged": len(successful),
        "errors": len(items) - len(successful),
        "wins": wins,
        "losses": losses,
        "ties": ties,
        "match_rate": match_rate,
        "win_rate": win_rate,
        "score": 0.7 * match_rate + 0.3 * win_rate,
    }


def write_results(output: Path, items: list[dict], summary: dict, sources: dict) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "method": "Локальная двухраундовая pairwise-оценка; не является платформенным Score",
        "sources": sources,
        "summary": summary,
        "items": items,
    }
    output.with_suffix(".json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    fields = [
        "id", "question", "round_1_score", "round_2_score", "score", "outcome",
        "round_1_reason", "round_2_reason", "error",
    ]
    with output.with_suffix(".csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for item in items:
            rounds = item["rounds"]
            writer.writerow({
                "id": item["id"],
                "question": item["question"],
                "round_1_score": rounds[0].get("score") if rounds else None,
                "round_2_score": rounds[1].get("score") if len(rounds) > 1 else None,
                "score": item["score"],
                "outcome": item["outcome"],
                "round_1_reason": rounds[0].get("reason") if rounds else None,
                "round_2_reason": rounds[1].get("reason") if len(rounds) > 1 else None,
                "error": item["error"],
            })


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", type=Path, default=ROOT / "data/demo_questions.csv")
    parser.add_argument("--golden", type=Path, default=ROOT / "data/demo_output.csv")
    parser.add_argument("--candidate", type=Path, default=ROOT / "evals/results/demo_comparison_rollback.json")
    parser.add_argument("--baseline", type=Path, default=ROOT / "evals/results/sample_baseline.csv")
    parser.add_argument(
        "--baseline-label",
        default="Учебный sample_submission.zip — proxy, не подтверждённый официальный baseline",
        help="Описание baseline для отчёта",
    )
    parser.add_argument("--output", type=Path, default=ROOT / "evals/results/pairwise_latest")
    parser.add_argument("--limit", type=int, help="Оценить только первые N вопросов для проверки")
    args = parser.parse_args()

    questions = read_questions(args.questions)
    if args.limit is not None:
        if args.limit < 1:
            parser.error("--limit должен быть положительным")
        questions = questions[:args.limit]
    golden = read_answers(args.golden)
    candidate = read_answers(args.candidate)
    baseline = read_answers(args.baseline)
    for name, answers in (("golden", golden), ("candidate", candidate), ("baseline", baseline)):
        missing = [row["id"] for row in questions if row["id"] not in answers]
        if missing:
            raise ValueError(f"В {name} отсутствуют ID: {', '.join(missing)}")

    items = []
    for row in questions:
        item = evaluate_question(row, golden[row["id"]], candidate[row["id"]], baseline[row["id"]])
        items.append(item)
        if item["error"]:
            print(f"{row['id']}: ERROR — {item['error']}")
            continue
        round_scores = ", ".join(str(round_result["score"]) for round_result in item["rounds"])
        print(f"{row['id']}: {item['outcome']}; score={item['score']:.3f}; раунды=[{round_scores}]")

    summary = calculate_summary(items)
    sources = {
        "questions": str(args.questions),
        "golden": str(args.golden),
        "candidate": str(args.candidate),
        "baseline": str(args.baseline),
        "baseline_status": args.baseline_label,
    }
    write_results(args.output, items, summary, sources)
    print("\nИтого:")
    print(f"- оценено: {summary['judged']}/{summary['questions']}; ошибок: {summary['errors']}")
    print(f"- победы/поражения/ничьи: {summary['wins']}/{summary['losses']}/{summary['ties']}")
    print(f"- Match Rate: {summary['match_rate']:.6f}")
    print(f"- Win Rate: {summary['win_rate']:.6f}")
    print(f"- локальный proxy Score: {summary['score']:.6f}")
    print(f"Результаты: {args.output.with_suffix('.json')} и {args.output.with_suffix('.csv')}")
    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
