"""Пакетный вход для платформы: questions.csv -> submission.csv."""

import csv
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

FALLBACK_ANSWER = "Извините, сейчас не получается ответить. Оставьте, пожалуйста, телефон, и менеджер свяжется с вами."
MAX_ANSWER_CHARS = 10_000
TOTAL_TIMEOUT_SECONDS = 20 * 60
logger = logging.getLogger("solution")


def read_questions(data_dir: Path) -> list[dict]:
    path = data_dir / "questions.csv"
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != ["id", "question"]:
            raise ValueError("questions.csv должен содержать ровно колонки id,question")
        rows = list(reader)
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("ID вопросов не должны повторяться")
    return rows


def parse_question(text: str) -> tuple[list[dict], str]:
    stripped = text.strip()
    if stripped.startswith("[") or stripped.startswith("{"):
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            history = payload.get("messages", [])
            message = payload.get("new_message") or payload.get("question") or ""
            return history, message
        if isinstance(payload, list):
            messages = [item for item in payload if item.get("role") in {"user", "assistant"}]
            for index in range(len(messages) - 1, -1, -1):
                if messages[index]["role"] == "user":
                    return messages[:index], messages[index]["content"]
    return [], text


def prepare_data(data_dir: Path) -> Path | None:
    archive = data_dir / "knowledge-base.zip"
    if not archive.exists():
        os.environ["ENERGYTOOL_DATA_DIR"] = str(data_dir)
        return None
    work_dir = Path(tempfile.mkdtemp(prefix="energytool-kb-"))
    kb_dir = work_dir / "knowledge-base"
    kb_dir.mkdir()
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            target = (kb_dir / info.filename).resolve()
            if os.path.commonpath([kb_dir.resolve(), target]) != str(kb_dir.resolve()):
                raise ValueError(f"Небезопасный путь в knowledge-base.zip: {info.filename}")
        zf.extractall(kb_dir)
    os.environ["ENERGYTOOL_DATA_DIR"] = str(work_dir)
    return work_dir


def answer_question(row: dict, respond) -> dict:
    history, message = parse_question(row["question"])
    try:
        result = respond(message, {"history": history})
        answer = result["reply"].strip()
    except Exception as exc:
        logger.error("Вопрос %s: %s", row["id"], exc)
        answer = FALLBACK_ANSWER
    if not answer:
        answer = FALLBACK_ANSWER
    return {"id": row["id"], "answer": answer[:MAX_ANSWER_CHARS]}


def validate_submission(path: Path, expected_ids: list[str]) -> None:
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != ["id", "answer"]:
            raise ValueError("submission.csv должен содержать ровно колонки id,answer")
        rows = list(reader)
    ids = [row["id"] for row in rows]
    if ids != expected_ids:
        raise ValueError("submission.csv содержит не все ID или меняет их порядок")
    if any(not row["answer"].strip() for row in rows):
        raise ValueError("Все ответы должны быть непустыми")
    if any(len(row["answer"]) > MAX_ANSWER_CHARS for row in rows):
        raise ValueError("Ответ длиннее 10000 символов")


def write_submission(rows: list[dict], expected_ids: list[str]) -> Path:
    path = Path.cwd() / "submission.csv"
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["id", "answer"])
        writer.writeheader()
        writer.writerows(rows)
    validate_submission(temporary, expected_ids)
    temporary.replace(path)
    return path


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    data_dir = Path(os.environ.get("DATA_DIR", "data")).resolve()
    questions = read_questions(data_dir)
    work_dir = prepare_data(data_dir)
    try:
        from agent import respond

        started = time.monotonic()
        workers = max(1, min(8, int(os.environ.get("MAX_WORKERS", "1"))))
        if workers == 1:
            answers = [answer_question(row, respond) for row in questions]
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                answers = list(executor.map(lambda row: answer_question(row, respond), questions))
        if time.monotonic() - started > TOTAL_TIMEOUT_SECONDS:
            raise TimeoutError("Превышен общий лимит выполнения 20 минут")
        path = write_submission(answers, [row["id"] for row in questions])
        print(f"Создан {path} с {len(answers)} ответами")
        return 0
    finally:
        if work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
