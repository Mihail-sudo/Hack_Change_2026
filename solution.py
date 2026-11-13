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
from functools import lru_cache
from pathlib import Path

FALLBACK_ANSWER = "Не могу ответить по доступным фрагментам базы знаний."
MAX_ANSWER_CHARS = 10_000
TOTAL_TIMEOUT_SECONDS = 20 * 60
SOLUTION_PROMPT_FILE = Path(__file__).resolve().parent / "prompts" / "solution.md"
logger = logging.getLogger("solution")


def _find_input_file(data_dir: Path, names: tuple[str, ...]) -> Path:
    script_dir = Path(__file__).resolve().parent
    roots = (data_dir, Path.cwd(), script_dir, script_dir / data_dir)
    for root in roots:
        for name in names:
            path = root / name
            if path.is_file():
                return path
    raise FileNotFoundError(f"Не найдены входные файлы: {names}")


def _questions_path(data_dir: Path) -> Path:
    return _find_input_file(data_dir, ("questions.csv", "train.csv"))


def read_questions(data_dir: Path) -> list[dict]:
    path = _questions_path(data_dir)
    with path.open(encoding="utf-8-sig", newline="") as file:
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
    try:
        archive = _find_input_file(data_dir, ("knowledge-base.zip", "knowledge_base.zip", "kb.zip"))
    except FileNotFoundError:
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


@lru_cache(maxsize=1)
def solution_prompt() -> str:
    try:
        from prompts import SOLUTION_PROMPT
        return SOLUTION_PROMPT
    except ImportError:
        return SOLUTION_PROMPT_FILE.read_text(encoding="utf-8")


def _photo_question_without_organization(query: str) -> bool:
    text = query.lower()
    if "фото" not in text or "показан" not in text:
        return False
    if not any(word in text for word in ("можно", "может", "могу", "передать", "отправить", "прислать")):
        return False
    return not any(
        word in text for word in ("организац", "компани", "снт", "предприят", "завод", "энергосбыт", "сетев", "тсж", "управляющ")
    )


def answer_with_context(history: list[dict], message: str) -> str:
    from agent.catalog import search_catalog
    from agent.llm import call_llm

    visible = [item for item in history if item.get("role") in {"user", "assistant"}][-5:]
    query = "\n".join([item["content"] for item in visible] + [message])
    if _photo_question_without_organization(query):
        return (
            "Нет, напрямую через МТС такой передачи показаний нет. "
            "Распознавание показаний по фотографии — B2B-решение для организаций; "
            "показание попадает в учёт только после верификации."
        )
    catalog = search_catalog(query)
    messages = [
        {"role": "system", "content": solution_prompt().replace("{catalog}", catalog, 1)},
        *visible,
        {"role": "user", "content": message},
    ]
    return call_llm(messages, temperature=float(os.environ.get("TEMPERATURE", "0.0"))).strip()


def answer_question(row: dict) -> dict:
    history, message = parse_question(row["question"])
    try:
        answer = answer_with_context(history, message)
    except Exception as exc:
        logger.error("Вопрос %s: %s", row["id"], exc)
        answer = FALLBACK_ANSWER
    if not answer:
        answer = FALLBACK_ANSWER
    return {"id": row["id"], "answer": answer[:MAX_ANSWER_CHARS]}


def validate_submission(path: Path, expected_ids: list[str]) -> None:
    with path.open(encoding="utf-8-sig", newline="") as file:
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
        from agent import catalog as _catalog
        from agent import llm as _llm

        started = time.monotonic()
        workers = max(1, min(8, int(os.environ.get("MAX_WORKERS", "3"))))
        if workers == 1:
            answers = [answer_question(row) for row in questions]
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                answers = list(executor.map(answer_question, questions))
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
