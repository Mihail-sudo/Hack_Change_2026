"""Запустить batch golden_cases из указанного ZIP-сабмита."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent

DRIVER = r'''
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from solution import answer_with_context
from catalog import search_catalog as original_search_catalog

golden_path, output_path, workers = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
cases = json.loads(golden_path.read_text(encoding="utf-8"))
local = threading.local()

def recording_search(query, limit=None):
    context = original_search_catalog(query, limit)
    local.context = context
    return context

import catalog
catalog.search_catalog = recording_search

def run(case):
    started = time.perf_counter()
    local.context = ""
    try:
        reply = answer_with_context(case.get("history", []), case["question"])
        result = {"reply": reply, "recommended": [], "action": {"type": "answer"}}
    except Exception as exc:
        result = {"reply": "", "recommended": [], "action": {"type": "error"}, "error": str(exc)}
    context = local.context
    result["retrieval_context"] = context
    result["retrieval_sources"] = list(dict.fromkeys(re.findall(r"(?m)^Источник: (.+)$", context)))
    result["seconds"] = round(time.perf_counter() - started, 3)
    result["id"] = case["id"]
    return result

results = []
with ThreadPoolExecutor(max_workers=workers) as executor:
    for result in executor.map(run, cases):
        results.append(result)
        print(f"{result['id']}: {result['seconds']:.2f} с", flush=True)
        output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--golden", type=Path, default=ROOT / "evals/golden_cases.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    args.golden = args.golden.resolve()
    args.output = args.output.resolve()
    args.zip = args.zip.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="release-zip-", dir=args.output.parent) as tmp:
        package = Path(tmp)
        with ZipFile(args.zip) as zf:
            zf.extractall(package)
        env = os.environ.copy()
        env["ENERGYTOOL_ENV_FILE"] = str(ROOT / ".env")
        env["ENERGYTOOL_DATA_DIR"] = str(ROOT / "data")
        completed = subprocess.run(
            [sys.executable, "-c", DRIVER, str(args.golden), str(args.output), str(args.workers)],
            cwd=package, env=env, timeout=1200,
        )
        if completed.returncode:
            raise SystemExit(completed.returncode)
    print(f"Сохранены результаты из {args.zip}: {args.output}")


if __name__ == "__main__":
    main()
