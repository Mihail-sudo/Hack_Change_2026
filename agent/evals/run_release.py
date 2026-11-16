"""Запустить golden_cases в batch или interactive режиме с сохранением контекстов."""

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent import respond
from agent.catalog import search_catalog as original_search_catalog
from solution import answer_with_context

local = threading.local()


def recording_search(query: str, limit: int | None = None) -> str:
    context = original_search_catalog(query, limit)
    local.context = context
    return context


def sources(context: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"(?m)^Источник: (.+)$", context)))


def run_case(case: dict, mode: str) -> dict:
    local.context = ""
    started = time.perf_counter()
    try:
        if mode == "interactive":
            result = respond(case["question"], {"history": case.get("history", [])})
        else:
            reply = answer_with_context(case.get("history", []), case["question"])
            result = {"reply": reply, "recommended": [], "action": {"type": "answer"}, "actions": []}
    except Exception as exc:
        result = {"reply": "", "recommended": [], "action": {"type": "error"}, "error": str(exc)}
    context = local.context
    result["retrieval_context"] = context
    result["retrieval_sources"] = sources(context)
    result["seconds"] = round(time.perf_counter() - started, 3)
    result["id"] = case["id"]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--golden", type=Path, default=ROOT / "evals/golden_cases.json")
    parser.add_argument("--mode", choices=["batch", "interactive"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--ids", nargs="*", help="Только выбранные ID для диагностического прогона")
    args = parser.parse_args()

    cases = json.loads(args.golden.read_text(encoding="utf-8"))
    if args.ids:
        selected = set(args.ids)
        cases = [case for case in cases if case["id"] in selected]
    import agent.agent as agent_module
    import agent.catalog as catalog_module
    import solution as solution_module
    agent_module.search_catalog = recording_search
    catalog_module.search_catalog = recording_search
    solution_module.search_catalog = recording_search

    args.output.parent.mkdir(parents=True, exist_ok=True)
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for result in executor.map(lambda case: run_case(case, args.mode), cases):
            results.append(result)
            status = "ERROR" if result.get("error") else "OK"
            print(f"{result['id']}: {status}; {result['seconds']:.2f} с", flush=True)
            args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Сохранено {len(results)} результатов: {args.output}")


if __name__ == "__main__":
    main()
