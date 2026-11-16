"""Вызов OpenAI-совместимой LLM через Polza или API организаторов."""

import logging
import os
import time
from functools import lru_cache
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://polza.ai/api/v1"
PROJECT_DIR = Path(__file__).resolve().parent.parent
TIMEOUT = float(os.environ.get("LLM_TIMEOUT_SECONDS", "4"))
MAX_ATTEMPTS = int(os.environ.get("LLM_MAX_ATTEMPTS", "1"))
RETRY_STATUSES = {429, 500, 502, 503, 504}


def _find_env_file() -> Path:
    for root in (PROJECT_DIR, PROJECT_DIR.parent):
        if (root / ".git").exists() or (root / "docker-compose.yml").is_file():
            return root / ".env"
    return PROJECT_DIR / ".env"


ENV_FILE = Path(os.environ["ENERGYTOOL_ENV_FILE"]) if os.environ.get("ENERGYTOOL_ENV_FILE") else _find_env_file()


class LLMError(RuntimeError):
    """Модель недоступна или вернула ответ, который нельзя использовать."""


def _environment(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


@lru_cache(maxsize=1)
def _settings() -> tuple[str, str, str]:
    base_url = _environment("LLM_BASE_URL", "BASE_URL", "OPENAI_BASE_URL")
    key = _environment("LLM_API_KEY", "OPENAI_API_KEY", "POLZA_AI_API_KEY")
    model = _environment("LLM_MODEL", "OPENAI_MODEL", "GEN_MODEL")

    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            name = name.strip()
            value = value.strip().strip('"').strip("'")
            if name in {"LLM_BASE_URL", "BASE_URL", "OPENAI_BASE_URL"} and not base_url:
                base_url = value
            elif name in {"LLM_API_KEY", "OPENAI_API_KEY", "POLZA_AI_API_KEY"} and not key:
                key = value
            elif name in {"LLM_MODEL", "OPENAI_MODEL", "GEN_MODEL"} and not model:
                model = value

    if not key:
        raise LLMError("Не задан LLM_API_KEY, OPENAI_API_KEY или POLZA_AI_API_KEY")
    if not model:
        raise LLMError("Не задан LLM_MODEL, OPENAI_MODEL или GEN_MODEL")
    return base_url or BASE_URL, key, model


def _post(payload: dict, key: str, base_url: str, endpoint: str = "chat/completions") -> requests.Response:
    for attempt in range(MAX_ATTEMPTS):
        started = time.time()
        try:
            response = requests.post(
                f"{base_url.rstrip('/')}/{endpoint}",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
                timeout=TIMEOUT,
            )
        except requests.RequestException as exc:
            if attempt + 1 >= MAX_ATTEMPTS:
                raise LLMError(f"Сеть недоступна после {MAX_ATTEMPTS} попыток: {exc}") from exc
            delay = 0.5 * (2 ** attempt)
            logger.warning("Ошибка сети LLM, повтор через %.1f с: %s", delay, exc)
            time.sleep(delay)
            continue

        logger.info("LLM ответила за %.1f с, статус %s", time.time() - started, response.status_code)
        if response.status_code == 200:
            return response
        if response.status_code not in RETRY_STATUSES or attempt + 1 >= MAX_ATTEMPTS:
            raise LLMError(f"API вернул {response.status_code}: {response.text[:300]}")
        delay = 0.5 * (2 ** attempt)
        logger.warning("Временная ошибка LLM %s, повтор через %.1f с", response.status_code, delay)
        time.sleep(delay)

    raise LLMError("Модель недоступна")


def call_llm(messages: list[dict], **params) -> str:
    """Отправить сообщения модели и вернуть текст ответа."""
    base_url, key, model = _settings()
    payload = {"model": model, "messages": messages}
    if not _environment("LLM_BASE_URL", "BASE_URL", "OPENAI_BASE_URL"):
        payload["reasoning"] = {"enabled": False}
    if _environment("TEMPERATURE") and "temperature" not in params:
        payload["temperature"] = float(_environment("TEMPERATURE"))
    if _environment("MAX_TOKENS") and "max_tokens" not in params:
        payload["max_tokens"] = int(_environment("MAX_TOKENS"))
    payload.update({k: v for k, v in params.items() if k != "reasoning"})

    response = _post(payload, key, base_url)
    try:
        message = response.json()["choices"][0]["message"]
    except (ValueError, KeyError, IndexError) as exc:
        raise LLMError(f"Неожиданный формат ответа: {response.text[:300]}") from exc

    content = message.get("content")
    if not content:
        raise LLMError("Модель вернула пустой ответ")
    return content


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Получить embeddings через тот же OpenAI-совместимый прокси."""
    if not texts:
        return []
    base_url, key, _ = _settings()
    key = _environment("EMBEDDER_API_KEY") or key
    model = _environment("EMB_MODEL") or "baai/bge-m3"
    response = _post(
        {"model": model, "input": texts},
        key,
        base_url,
        endpoint="embeddings",
    )
    try:
        data = response.json()["data"]
        embeddings = [item["embedding"] for item in sorted(data, key=lambda item: item["index"])]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"Неожиданный ответ embeddings: {response.text[:300]}") from exc
    if len(embeddings) != len(texts):
        raise LLMError("Количество embeddings не совпадает с числом текстов")
    return embeddings
