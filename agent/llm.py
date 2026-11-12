"""Вызов модели. Единственное место, где знаем про провайдера LLM (polza.ai)."""

import logging
import os
import time
from functools import lru_cache
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://polza.ai/api/v1"
PROJECT_DIR = Path(__file__).resolve().parent.parent
TIMEOUT = 20
MAX_ATTEMPTS = 3
RETRY_STATUSES = {429, 500, 502, 503, 504}


def _find_env_file() -> Path:
    for root in (PROJECT_DIR, PROJECT_DIR.parent):
        if (root / ".git").exists() or (root / "docker-compose.yml").is_file():
            return root / ".env"
    return PROJECT_DIR / ".env"


ENV_FILE = _find_env_file()


class LLMError(RuntimeError):
    """Модель недоступна или вернула ответ, который нельзя использовать."""


@lru_cache(maxsize=1)
def _settings() -> tuple[str, str]:
    """Ключ и модель. Окружение важнее .env. Кешируется на процесс."""
    key = os.environ.get("POLZA_AI_API_KEY", "")
    model = os.environ.get("LLM_MODEL", "")

    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if name.strip() == "POLZA_AI_API_KEY" and not key:
                key = value
            elif name.strip() == "LLM_MODEL" and not model:
                model = value

    if not key:
        raise LLMError("Не задан POLZA_AI_API_KEY (в .env или в окружении)")
    if not model:
        raise LLMError("Не задан LLM_MODEL (в .env или в окружении)")
    return key, model


def _post(payload: dict, key: str) -> requests.Response:
    for attempt in range(MAX_ATTEMPTS):
        started = time.time()
        try:
            response = requests.post(
                f"{BASE_URL}/chat/completions",
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
    key, model = _settings()
    payload = {
        "model": model,
        "messages": messages,
        "reasoning": {"enabled": False},
        **{k: v for k, v in params.items() if k != "reasoning"},
    }
    response = _post(payload, key)

    try:
        message = response.json()["choices"][0]["message"]
    except (ValueError, KeyError, IndexError) as exc:
        raise LLMError(f"Неожиданный формат ответа: {response.text[:300]}") from exc

    content = message.get("content")
    if not content:
        raise LLMError("Модель вернула пустой ответ")
    return content
