"""Вызов модели. Единственное место, где знаем про провайдера LLM (polza.ai).

Правила из CLAUDE.md:
- нигде больше не импортируем SDK и не называем модель;
- ключ и модель берём из .env (или окружения), в коде и логах их нет;
- рассуждения отключены всегда: с ними запрос идёт ~30 с вместо ~1,6 с.

Ошибки не глотаем и не превращаем в текст ответа: бросаем LLMError, а как
реагировать, решает вызывающий (API отдаёт запасную фразу, cli.py печатает).
"""

import logging
import os
import time
from functools import lru_cache
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://polza.ai/api/v1"
PROJECT_DIR = Path(__file__).resolve().parent.parent
TIMEOUT = 90


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


def call_llm(messages: list[dict], **params) -> str:
    """Отправить сообщения модели и вернуть текст ответа.

    messages — список словарей {"role": ..., "content": ...} в формате OpenAI.
    params — дополнительные поля запроса (temperature, response_format, ...).
    Режим рассуждений задаётся здесь и через params не переопределяется.
    """
    key, model = _settings()

    payload = {
        "model": model,
        "messages": messages,
        "reasoning": {"enabled": False},
        **{k: v for k, v in params.items() if k != "reasoning"},
    }

    started = time.time()
    try:
        response = requests.post(
            f"{BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise LLMError(f"Сеть недоступна: {exc}") from exc

    logger.info("LLM ответила за %.1f с, статус %s", time.time() - started, response.status_code)

    if response.status_code != 200:
        # Тело может содержать подсказку провайдера (лимит, отозванный ключ), но не ключ.
        raise LLMError(f"API вернул {response.status_code}: {response.text[:300]}")

    try:
        message = response.json()["choices"][0]["message"]
    except (ValueError, KeyError, IndexError) as exc:
        raise LLMError(f"Неожиданный формат ответа: {response.text[:300]}") from exc

    content = message.get("content")
    if not content:
        raise LLMError("Модель вернула пустой ответ")
    return content