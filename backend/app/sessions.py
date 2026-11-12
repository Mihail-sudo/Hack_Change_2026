"""Хранилище состояний чат-сессий.

Состояние диалога для API — чёрный ящик (docs/contract.md): сохраняем и
возвращаем его целиком, не заглядывая внутрь. Ключ живёт ограниченное время
и продлевается при каждом сохранении.
"""

import json
import time
from typing import Protocol

import redis.asyncio as redis

from app.config import Settings


class SessionStoreError(RuntimeError):
    """Хранилище сессий недоступно или вернуло некорректные данные."""


class SessionStore(Protocol):
    async def get(self, session_id: str) -> dict | None: ...

    async def save(self, session_id: str, state: dict) -> None: ...

    async def reset(self, session_id: str) -> None: ...

    async def close(self) -> None: ...


class RedisSessionStore:
    def __init__(self, client: redis.Redis, ttl_seconds: int, key_prefix: str) -> None:
        self._client = client
        self._ttl_seconds = ttl_seconds
        self._key_prefix = key_prefix

    def _key(self, session_id: str) -> str:
        return f"{self._key_prefix}{session_id}"

    async def get(self, session_id: str) -> dict | None:
        try:
            raw = await self._client.get(self._key(session_id))
        except redis.RedisError as exc:
            raise SessionStoreError("redis get failed") from exc

        if raw is None:
            return None

        try:
            state = json.loads(raw)
        except ValueError as exc:
            raise SessionStoreError("session state is corrupted") from exc

        if not isinstance(state, dict):
            raise SessionStoreError("session state is not an object")
        return state

    async def save(self, session_id: str, state: dict) -> None:
        try:
            payload = json.dumps(state, ensure_ascii=False)
        except (TypeError, ValueError) as exc:
            raise SessionStoreError("session state is not JSON-serializable") from exc

        try:
            await self._client.set(
                self._key(session_id),
                payload,
                ex=self._ttl_seconds,
            )
        except redis.RedisError as exc:
            raise SessionStoreError("redis set failed") from exc

    async def reset(self, session_id: str) -> None:
        try:
            await self._client.delete(self._key(session_id))
        except redis.RedisError as exc:
            raise SessionStoreError("redis delete failed") from exc

    async def close(self) -> None:
        await self._client.aclose()


class MemorySessionStore:
    """In-memory реализация для тестов и запуска без Redis."""

    def __init__(self, ttl_seconds: int) -> None:
        self._ttl_seconds = ttl_seconds
        self._data: dict[str, tuple[float, dict]] = {}

    def _alive(self, session_id: str) -> dict | None:
        item = self._data.get(session_id)
        if item is None:
            return None
        expires_at, state = item
        if expires_at <= time.monotonic():
            self._data.pop(session_id, None)
            return None
        return state

    async def get(self, session_id: str) -> dict | None:
        state = self._alive(session_id)
        if state is None:
            return None
        return json.loads(json.dumps(state, ensure_ascii=False))

    async def save(self, session_id: str, state: dict) -> None:
        try:
            payload = json.dumps(state, ensure_ascii=False)
        except (TypeError, ValueError) as exc:
            raise SessionStoreError("session state is not JSON-serializable") from exc
        self._data[session_id] = (
            time.monotonic() + self._ttl_seconds,
            json.loads(payload),
        )

    async def reset(self, session_id: str) -> None:
        self._data.pop(session_id, None)

    async def close(self) -> None:
        self._data.clear()


def create_session_store(settings: Settings) -> SessionStore:
    if settings.session_backend == "memory":
        return MemorySessionStore(ttl_seconds=settings.session_ttl_seconds)

    client = redis.from_url(settings.redis_url, decode_responses=True)
    return RedisSessionStore(
        client=client,
        ttl_seconds=settings.session_ttl_seconds,
        key_prefix=settings.redis_key_prefix,
    )
