import json
import re
from dataclasses import dataclass
from pathlib import Path

from app.models import Source

_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9]+")


@dataclass(frozen=True)
class KnowledgeDocument:
    id: str
    title: str
    content: str
    tags: tuple[str, ...] = ()

    def to_source(self, score: float) -> Source:
        return Source(id=self.id, title=self.title, score=round(score, 3))


@dataclass(frozen=True)
class SearchHit:
    document: KnowledgeDocument
    score: float


def _normalize(text: str) -> str:
    return text.lower().replace("ё", "е")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(_normalize(text))


def _term_matches(query_term: str, document_term: str) -> bool:
    if query_term == document_term:
        return True
    if len(query_term) < 4 or len(document_term) < 4:
        return False
    return query_term.startswith(document_term) or document_term.startswith(query_term)


class KnowledgeBase:
    def __init__(self, documents: list[KnowledgeDocument]) -> None:
        self._documents = documents
        self._tokens = {
            document.id: {
                "title": _tokenize(document.title),
                "tags": _tokenize(" ".join(document.tags)),
                "content": _tokenize(document.content),
            }
            for document in documents
        }

    @classmethod
    def from_file(cls, path: Path) -> "KnowledgeBase":
        if not path.exists():
            raise FileNotFoundError(f"Knowledge base not found: {path}")

        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            raise ValueError("Knowledge base must be a JSON array")

        documents = []
        for item in raw:
            documents.append(
                KnowledgeDocument(
                    id=str(item["id"]),
                    title=str(item["title"]),
                    content=str(item["content"]),
                    tags=tuple(str(tag) for tag in item.get("tags", [])),
                )
            )
        return cls(documents)

    @property
    def size(self) -> int:
        return len(self._documents)

    def search(self, query: str, top_k: int = 3) -> list[SearchHit]:
        query_tokens = list(dict.fromkeys(_tokenize(query)))
        if not query_tokens or top_k <= 0:
            return []

        hits: list[SearchHit] = []
        for document in self._documents:
            document_tokens = self._tokens[document.id]
            score = 0.0
            for query_term in query_tokens:
                for field, weight in (("title", 4.0), ("tags", 3.0), ("content", 1.0)):
                    matches = sum(
                        1
                        for document_term in document_tokens[field]
                        if _term_matches(query_term, document_term)
                    )
                    score += weight * min(matches, 3)
            if score > 0:
                hits.append(SearchHit(document=document, score=score))

        hits.sort(key=lambda hit: (-hit.score, hit.document.title))
        return hits[:top_k]
