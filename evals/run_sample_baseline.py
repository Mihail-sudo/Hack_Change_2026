"""Получить ответы учебного sample_submission.zip для локального proxy-baseline."""

import argparse
import csv
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent.llm import _settings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sample", type=Path, default=ROOT / "data/sample_submission.zip")
    parser.add_argument("--knowledge-base", type=Path, default=ROOT / "data/knowledge-base")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()

    with args.questions.open(encoding="utf-8-sig", newline="") as file:
        questions = list(csv.DictReader(file))
    expected_ids = [str(row["id"]) for row in questions]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    base_url, key, model = _settings()

    with tempfile.TemporaryDirectory(prefix="sample-baseline-", dir=args.output.parent) as tmp:
        work = Path(tmp)
        package = work / "package"
        data = work / "data"
        package.mkdir()
        data.mkdir()
        with ZipFile(args.sample) as zf:
            zf.extractall(package)
        shutil.copyfile(args.questions, data / "questions.csv")
        with ZipFile(data / "knowledge-base.zip", "w", compression=ZIP_DEFLATED) as zf:
            for pattern in ("*.md", "*.txt"):
                for path in sorted(args.knowledge_base.rglob(pattern)):
                    zf.write(path, path.relative_to(args.knowledge_base).as_posix())

        env = os.environ.copy()
        env.update({
            "DATA_DIR": str(data),
            "LLM_BASE_URL": base_url,
            "LLM_API_KEY": key,
            "LLM_MODEL": model,
            "MAX_WORKERS": str(args.workers),
            "TEMPERATURE": "0.0",
        })
        subprocess.run(
            [sys.executable, "solution.py"], cwd=package, env=env,
            check=True, timeout=300,
        )
        result = package / "submission.csv"
        with result.open(encoding="utf-8-sig", newline="") as file:
            rows = list(csv.DictReader(file))
        ids = [str(row["id"]) for row in rows]
        if ids != expected_ids or any(not row["answer"].strip() for row in rows):
            raise ValueError("Учебный baseline вернул некорректный submission.csv")
        shutil.copyfile(result, args.output)

    print(f"Proxy-baseline сохранён: {args.output} ({len(expected_ids)} ответов)")


if __name__ == "__main__":
    main()
