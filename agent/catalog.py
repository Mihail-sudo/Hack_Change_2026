"""Официальная база знаний EnergyTool и полнотекстовый поиск по ней."""

import logging
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KB_DIR = DATA_DIR / "knowledge-base"
INVALID_CONTENT_MARKERS = (
    "The URL you requested has been blocked",
    "Web Page Blocked!",
    "You need to enable JavaScript to run this app",
)
ALWAYS_INCLUDE = {
    "00-reference/00-product-map.md",
    "00-reference/02-product-scope-and-limits.md",
}
MAX_CHUNKS = 6
MAX_CHUNK_CHARS = 5500
TOKEN_RE = re.compile(r"[a-zа-я0-9]+", re.IGNORECASE)
STOP_WORDS = {
    "без", "более", "будет", "быть", "вам", "ваш", "вот", "все", "вы", "где",
    "для", "если", "есть", "за", "и", "или", "как", "какой", "когда", "клиент",
    "можно", "мтс", "на", "нам", "нас", "не", "него", "нужно", "он", "она", "они",
    "от", "по", "под", "пока", "после", "при", "продае", "продукт", "работает", "решение",
    "сам", "свой", "система", "сколько", "с", "такой", "только", "у", "что", "это",
}


def _read_valid(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        logger.warning("Пустой файл базы знаний пропущен: %s", path)
        return None
    if any(marker in text for marker in INVALID_CONTENT_MARKERS):
        logger.warning("Невалидная выгрузка базы знаний пропущена: %s", path)
        return None
    return text


def _terms(text: str) -> list[str]:
    terms = []
    for token in TOKEN_RE.findall(text.lower().replace("ё", "е")):
        if token in STOP_WORDS or len(token) < 3:
            continue
        term = token if len(token) <= 5 else token[:6]
        if term not in STOP_WORDS:
            terms.append(term)
    return terms


def _split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    chunks = []
    current = ""
    for line in text.splitlines(keepends=True):
        while len(line) > MAX_CHUNK_CHARS:
            if current:
                chunks.append(current.strip())
                current = ""
            chunks.append(line[:MAX_CHUNK_CHARS].strip())
            line = line[MAX_CHUNK_CHARS:]
        if len(current) + len(line) > MAX_CHUNK_CHARS and current:
            chunks.append(current.strip())
            current = ""
        current += line
    if current.strip():
        chunks.append(current.strip())
    return chunks


@lru_cache(maxsize=1)
def _chunks() -> tuple[dict, ...]:
    chunks = []
    paths = sorted(KB_DIR.rglob("*.md"))
    if not paths:
        raise RuntimeError(f"Нет Markdown-файлов официальной базы в {KB_DIR}")
    for path in paths:
        text = _read_valid(path)
        if not text:
            continue
        source = path.relative_to(KB_DIR).as_posix()
        document_title = text.splitlines()[0].removeprefix("# ").strip()
        for section in re.split(r"(?m)(?=^#{1,2} )", text):
            section = section.strip()
            if not section:
                continue
            section_title = section.splitlines()[0].lstrip("# ").strip()
            for part in _split_long(section):
                chunks.append({
                    "source": source,
                    "title": f"{document_title} / {section_title}",
                    "text": part,
                    "terms": Counter(_terms(part)),
                    "title_terms": set(_terms(f"{document_title} {section_title}")),
                })
    if not chunks:
        raise RuntimeError(f"Нет валидных данных официальной базы в {KB_DIR}")
    return tuple(chunks)


@lru_cache(maxsize=1)
def load_catalog() -> str:
    """Полный текст официальной базы для диагностики и выгрузок."""
    sections = []
    for path in sorted(KB_DIR.rglob("*.md")):
        text = _read_valid(path)
        if text:
            source = path.relative_to(KB_DIR).as_posix()
            sections.append(f"Источник: {source}\n\n{text}")
    if not sections:
        raise RuntimeError(f"Нет валидных данных официальной базы в {KB_DIR}")
    return "\n\n---\n\n".join(sections)


def search_catalog(query: str, limit: int = MAX_CHUNKS) -> str:
    """Найти релевантные разделы и обязательные правила без обращения к LLM."""
    chunks = _chunks()
    query_terms = set(_terms(query))
    selected = [chunk for chunk in chunks if chunk["source"] in ALWAYS_INCLUDE]

    if query_terms:
        frequency = Counter()
        for chunk in chunks:
            frequency.update(chunk["terms"].keys())
        total = len(chunks)
        scored = []
        for index, chunk in enumerate(chunks):
            if chunk["source"] in ALWAYS_INCLUDE:
                continue
            score = 0.0
            for term in query_terms:
                count = chunk["terms"].get(term, 0)
                if not count:
                    continue
                weight = 1 + math.log(total / frequency[term])
                score += weight * (1 + min(count, 3) * 0.25)
                if term in chunk["title_terms"]:
                    score += weight * 2
            if score > 0:
                scored.append((score, -index, chunk))
        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        per_source = Counter()
        for _, _, chunk in scored:
            source = chunk["source"]
            if per_source[source] >= 1:
                continue
            selected.append(chunk)
            per_source[source] += 1
            if per_source.total() >= limit:
                break

    return "\n\n---\n\n".join(
        f"Источник: {chunk['source']}\n\n{chunk['text']}" for chunk in selected
    )
