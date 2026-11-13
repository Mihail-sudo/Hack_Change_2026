"""Официальная база знаний EnergyTool и полнотекстовый поиск по ней."""

import hashlib
import json
import logging
import math
import os
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("ENERGYTOOL_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
KB_DIR = DATA_DIR / "knowledge-base"
EMBEDDINGS_CACHE = DATA_DIR / "knowledge-base-embeddings.json"
INVALID_CONTENT_MARKERS = (
    "The URL you requested has been blocked",
    "Web Page Blocked!",
    "You need to enable JavaScript to run this app",
)
ALWAYS_INCLUDE = {
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
    synonyms = {"фасад": ("вертик",)}
    for token in TOKEN_RE.findall(text.lower().replace("ё", "е")):
        if token in STOP_WORDS or len(token) < 3:
            continue
        term = token if len(token) <= 5 else token[:6]
        if term not in STOP_WORDS:
            terms.append(term)
            terms.extend(synonyms.get(term, ()))
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


def _lexical_ranking(query_terms: set[str], chunks: tuple[dict, ...]) -> list[tuple[float, dict]]:
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
            scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored


@lru_cache(maxsize=1)
def _chunk_embeddings() -> tuple[tuple[float, ...], ...]:
    from agent.llm import embed_texts

    chunks = _chunks()
    model = os.environ.get("EMB_MODEL", "BAAI/bge-m3")
    fingerprint = hashlib.sha256(
        (model + "\n" + "\n".join(chunk["text"] for chunk in chunks)).encode("utf-8")
    ).hexdigest()
    if EMBEDDINGS_CACHE.exists():
        try:
            cached = json.loads(EMBEDDINGS_CACHE.read_text(encoding="utf-8"))
            if cached.get("fingerprint") == fingerprint and len(cached.get("vectors", [])) == len(chunks):
                return tuple(tuple(vector) for vector in cached["vectors"])
        except (OSError, ValueError, TypeError) as exc:
            logger.warning("Кэш embeddings игнорируется: %s", exc)

    vectors = []
    for start in range(0, len(chunks), 16):
        vectors.extend(embed_texts([chunk["text"] for chunk in chunks[start:start + 16]]))
    try:
        temporary = EMBEDDINGS_CACHE.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"fingerprint": fingerprint, "vectors": vectors}), encoding="utf-8"
        )
        temporary.replace(EMBEDDINGS_CACHE)
    except OSError as exc:
        logger.warning("Не удалось сохранить кэш embeddings: %s", exc)
    return tuple(tuple(vector) for vector in vectors)


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    return numerator / (left_norm * right_norm) if left_norm and right_norm else 0.0


_SEMANTIC_DISABLED = False


def _semantic_ranking(query: str, chunks: tuple[dict, ...]) -> list[tuple[float, dict]]:
    from agent.llm import embed_texts

    global _SEMANTIC_DISABLED
    if _SEMANTIC_DISABLED:
        return []
    try:
        query_embedding = embed_texts([query])[0]
        embeddings = _chunk_embeddings()
    except Exception as exc:
        _SEMANTIC_DISABLED = True
        logger.warning("Embeddings недоступны, используется лексический поиск: %s", exc)
        return []
    scored = [
        (_cosine(tuple(query_embedding), embeddings[index]), chunk)
        for index, chunk in enumerate(chunks)
        if chunk["source"] not in ALWAYS_INCLUDE
    ]
    scored.sort(key=lambda item: item[0], reverse=True)
    threshold = float(os.environ.get("SEMANTIC_MIN_SCORE", "0.25"))
    return [item for item in scored if item[0] >= threshold]


def _hybrid_ranking(query: str, chunks: tuple[dict, ...]) -> list[dict]:
    lexical = _lexical_ranking(set(_terms(query)), chunks)
    if os.environ.get("RETRIEVAL_MODE", "hybrid") == "lexical":
        return [chunk for _, chunk in lexical]
    semantic = _semantic_ranking(query, chunks) if lexical or os.environ.get("SEMANTIC_FALLBACK") else []
    if not semantic:
        return [chunk for _, chunk in lexical]

    scores = {}
    combined = {}
    for ranking in (lexical, semantic):
        for rank, (_, chunk) in enumerate(ranking, 1):
            key = id(chunk)
            scores[key] = scores.get(key, 0.0) + 1 / (60 + rank)
            combined[key] = chunk
    query_terms = set(_terms(query))
    for chunk in combined.values():
        text = chunk["text"].lower()
        exact_matches = sum(term in text for term in query_terms)
        scores[id(chunk)] += exact_matches * 0.2
    ordered = sorted(combined.values(), key=lambda chunk: scores[id(chunk)], reverse=True)
    return ordered


def search_catalog(query: str, limit: int | None = None) -> str:
    """Найти релевантные разделы гибридным поиском и обязательные ограничения."""
    limit = int(os.environ.get("TOP_K", MAX_CHUNKS)) if limit is None else limit
    chunks = _chunks()
    selected = [chunk for chunk in chunks if chunk["source"] in ALWAYS_INCLUDE]
    per_source = Counter()
    for chunk in _hybrid_ranking(query, chunks):
        source = chunk["source"]
        if per_source[source] >= 2:
            continue
        selected.append(chunk)
        per_source[source] += 1
        if per_source.total() >= limit:
            break
    return "\n\n---\n\n".join(
        f"Источник: {chunk['source']}\n\n{chunk['text']}" for chunk in selected
    )
