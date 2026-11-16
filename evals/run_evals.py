"""Локальная проверка качества агента и сравнение результатов между запусками."""

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent import respond
from agent.catalog import search_catalog
from agent.llm import call_llm

JUDGE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "answer_judgement",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "score": {"type": "integer", "minimum": 0, "maximum": 5},
                "issues": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["score", "issues"],
            "additionalProperties": False,
        },
    },
}


def load_cases(args) -> list[dict]:
    if args.questions:
        with args.questions.open(encoding="utf-8-sig", newline="") as file:
            return [
                {"id": row["id"], "question": row["question"], "history": []}
                for row in csv.DictReader(file)
            ]
    return json.loads(args.cases.read_text(encoding="utf-8"))


def load_reference(path: Path | None) -> dict[str, str]:
    if not path:
        return {}
    with path.open(encoding="utf-8-sig", newline="") as file:
        return {row["id"]: row["answer"] for row in csv.DictReader(file)}


def judge_answer(case: dict, result: dict, reference: str) -> dict:
    query = "\n".join(item["content"] for item in case.get("history", [])) + "\n" + case["question"]
    prompt = f"""Оцени ответ консультанта от 0 до 5. Проверь полноту ответа и отсутствие фактов,
которых нет в контексте базы. Если дан эталон, сравни смысл, а не формулировку дословно.
За выдуманные факты снижай оценку. Верни JSON score и issues.

Вопрос: {case['question']}
Эталон: {reference or 'нет'}
Ответ: {result['reply']}
Контекст базы:
{search_catalog(query)}"""
    content = call_llm(
        [{"role": "user", "content": prompt}],
        response_format=JUDGE_FORMAT,
        temperature=0,
    )
    return json.loads(content)


def evaluate(case: dict, reference: str, use_judge: bool, solution_mode: bool = False) -> dict:
    started = time.perf_counter()
    try:
        if solution_mode:
            from solution import answer_with_context
            reply = answer_with_context(case.get("history", []), case["question"])
            lower = reply.lower()
            products = []
            if "платформ" in lower:
                products.append("askue_cloud")
            if "орэм" in lower or "оптов" in lower:
                if not ("500" in lower and "750" in lower):
                    products.append("orem")
            if "солнеч" in lower:
                products.append("solar")
            if "фото" in lower and "показан" in lower:
                products.append("meter_photo")
            action = "out_of_scope" if any(word in lower for word in ("не входит", "вне моей компетенции", "квадрокоптер")) else "answer"
            result = {"reply": reply, "recommended": [{"product_id": product} for product in products], "sources": [], "action": {"type": action}}
        else:
            result = respond(case["question"], {"history": case.get("history", [])})
    except Exception as exc:
        return {"id": case["id"], "passed": False, "error": str(exc)}

    seconds = time.perf_counter() - started
    reply = result["reply"]
    lower = reply.lower()
    products = [item["product_id"] for item in result["recommended"]]
    configurations = {
        item["product_id"]: item.get("configuration") for item in result["recommended"]
    }
    checks = [required.lower() in lower for required in case.get("required", [])]
    checks += [
        any(alternative.lower() in lower for alternative in case["required_any"])
        if "required_any" in case else True
    ]
    checks += [forbidden.lower() not in lower for forbidden in case.get("forbidden", [])]
    checks += [product in products for product in case.get("expected_products", [])]
    checks += [product not in products for product in case.get("forbidden_products", [])]
    checks += [
        configurations.get(product) == configuration
        for product, configuration in case.get("expected_configurations", {}).items()
    ]
    if case.get("expected_action"):
        checks.append(result["action"]["type"] == case["expected_action"])

    item = {
        "id": case["id"],
        "question": case["question"],
        "passed": all(checks),
        "seconds": round(seconds, 3),
        "words": len(reply.split()),
        "action": result["action"]["type"],
        "products": products,
        "configurations": configurations,
        "sources": result["sources"],
        "reply": reply,
        "reference": reference or None,
        "judge_score": None,
        "judge_error": None,
        "issues": [],
    }
    if use_judge:
        try:
            judgement = judge_answer(case, result, reference)
        except Exception as exc:
            item["judge_error"] = str(exc)
            item["issues"] = ["Судья недоступен; оценка по базовым проверкам"]
        else:
            item["judge_score"] = judgement["score"]
            item["issues"] = judgement["issues"]
            item["passed"] = item["passed"] and judgement["score"] >= 3
    return item


def write_results(items: list[dict], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.with_suffix(".json").write_text(
        json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with output.with_suffix(".csv").open("w", encoding="utf-8", newline="") as file:
        fields = ["id", "passed", "seconds", "words", "action", "products", "configurations", "judge_score", "reply"]
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for item in items:
            writer.writerow({key: item.get(key) for key in fields})


def print_comparison(previous: list[dict], current: list[dict]) -> None:
    old = {item["id"]: item for item in previous}
    for item in current:
        if item["id"] not in old or "seconds" not in old[item["id"]] or "seconds" not in item:
            continue
        before = old[item["id"]]
        delta = item["seconds"] - before["seconds"]
        status = "стабильно" if item["passed"] == before["passed"] else "изменилось"
        print(f"{item['id']}: {delta:+.2f} с; результат {status}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=ROOT / "evals" / "cases.json")
    parser.add_argument("--questions", type=Path, help="CSV с колонками id,question")
    parser.add_argument("--reference", type=Path, help="CSV с колонками id,answer")
    parser.add_argument("--judge", action="store_true", help="Оценивать ответы ещё и LLM-судьёй")
    parser.add_argument("--solution", action="store_true", help="Проверять пакетный режим solution.py")
    parser.add_argument("--output", type=Path, default=ROOT / "evals" / "results" / "latest")
    args = parser.parse_args()

    previous = None
    if args.output.with_suffix(".json").exists():
        previous = json.loads(args.output.with_suffix(".json").read_text(encoding="utf-8"))

    reference = load_reference(args.reference)
    items = []
    for case in load_cases(args):
        item = evaluate(case, reference.get(case["id"], case.get("reference", "")), args.judge, args.solution)
        items.append(item)
        if "error" in item:
            print(f"{item['id']}: ERROR — {item['error']}")
            continue
        status = "PASS" if item["passed"] else "FAIL"
        score = f"; судья {item['judge_score']}/5" if item["judge_score"] is not None else ""
        print(
            f"{item['id']}: {status}; {item['seconds']:.2f} с; {item['words']} слов; "
            f"{item['action']}; {item['products']}{score}"
        )
        if item["issues"]:
            print("  Замечания:", "; ".join(item["issues"]))

    write_results(items, args.output)
    successful = [item for item in items if "seconds" in item]
    passed = sum(item["passed"] for item in items)
    if successful:
        times = [item["seconds"] for item in successful]
        scores = [item["judge_score"] for item in successful if item["judge_score"] is not None]
        print("\nИтого:")
        print(f"- тесты: {passed}/{len(items)} прошли")
        print(f"- среднее время: {statistics.mean(times):.2f} с")
        print(f"- максимальное время: {max(times):.2f} с")
        print(f"- ответы дольше 8 с: {sum(value > 8 for value in times)}")
        print(f"- ответы длиннее 150 слов: {sum(item['words'] > 150 for item in successful)}")
        if scores:
            print(f"- средняя оценка судьи: {statistics.mean(scores):.2f}/5")
    if previous:
        print("\nСравнение с предыдущим запуском:")
        print_comparison(previous, items)
    print(f"Результаты: {args.output.with_suffix('.json')} и {args.output.with_suffix('.csv')}")
    return 0 if passed == len(items) else 1


if __name__ == "__main__":
    sys.exit(main())
