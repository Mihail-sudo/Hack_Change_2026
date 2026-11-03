"""Сравнение моделей polza.ai для агента: JSON по схеме, вызов инструментов, скорость.

Запуск:
    python parsing/check_models.py <модель1> <модель2> ...
Ключ берётся из .env (POLZA_AI_API_KEY) или из окружения. На каждую модель уходит 2 запроса
к платному API — не запускай в цикле. Рассуждения отключены. Результат смотрим глазами и записываем выбор в .env.
"""

import json
import os
import sys
import time
from pathlib import Path

import requests

BASE_URL = "https://polza.ai/api/v1"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

JSON_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "slots",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"segment": {"type": ["string", "null"]}, "objects": {"type": ["integer", "null"]}},
            "required": ["segment", "objects"],
            "additionalProperties": False,
        },
    },
}
TOOL = {
    "type": "function",
    "function": {
        "name": "get_price",
        "description": "Цена продукта",
        "parameters": {"type": "object", "properties": {"product": {"type": "string"}}, "required": ["product"]},
    },
}


def api_key() -> str:
    key = os.environ.get("POLZA_AI_API_KEY", "")
    if not key and ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith("POLZA_AI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("Не задан POLZA_AI_API_KEY (в .env или в окружении)")
    return key


def post(key: str, model: str, **extra) -> tuple[dict, float]:
    t = time.time()
    r = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        # Режим рассуждений для агента отключён (см. CLAUDE.md): у polza.ai это reasoning.enabled=false.
        # Проверено: reasoning_effort="none" модель игнорирует, а этот параметр даёт 0 токенов рассуждений.
        json={"model": model, "reasoning": {"enabled": False}, **extra},
        timeout=90,
    )
    r.raise_for_status()
    return r.json(), time.time() - t


def check(key: str, model: str) -> None:
    js, tools, sec = "-", "-", "-"
    try:
        data, t = post(
            key, model,
            messages=[{"role": "user", "content": "У меня СНТ, 40 участков. Заполни слоты."}],
            response_format=JSON_FORMAT,
        )
        json.loads(data["choices"][0]["message"]["content"])
        js, sec = "ok", f"{t:.1f}"
    except Exception as e:
        js = f"fail ({type(e).__name__})"
    try:
        data, _ = post(
            key, model,
            messages=[{"role": "user", "content": "Сколько стоит АСКУЭ? Используй инструмент."}],
            tools=[TOOL],
        )
        tools = "ok" if data["choices"][0]["message"].get("tool_calls") else "no call"
    except Exception as e:
        tools = f"fail ({type(e).__name__})"
    print(f"{model:40} json={js:16} tools={tools:12} sec={sec}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    key = api_key()
    for m in sys.argv[1:]:
        check(key, m)
