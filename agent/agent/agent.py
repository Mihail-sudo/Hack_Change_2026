"""Ответ на сообщение клиента. Контракт: respond(message, state) -> AgentResult.

Этапы 1–2: сквозная цепочка «ввод → модель → ответ», память диалога
и полнотекстовый поиск по официальной базе знаний.
Слотов, сегментов, управляемого подбора продукта и лида пока нет — это этапы 3–5.

Правила из CLAUDE.md, которые важны именно в этом модуле:
- нет print() и input(): ввод-вывод только в cli.py;
- нет глобального состояния диалога: всё в state, который пришёл и ушёл;
- state сериализуется в JSON: только строки, числа, bool, None, списки, словари;
- агент сам ничего не сохраняет и не отправляет — действия возвращает в actions.
"""

import logging
from functools import lru_cache
from pathlib import Path

from agent.catalog import search_catalog
from agent.llm import call_llm

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "system.md"

# Ограничение истории: каждый ход — это токены в каждом следующем запросе.
# Держим последние реплики, чтобы длинный диалог не раздувал счёт за токены.
MAX_HISTORY_MESSAGES = 40


@lru_cache(maxsize=1)
def _system_prompt_template() -> str:
    text = SYSTEM_PROMPT_FILE.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError(f"Пустой системный промпт: {SYSTEM_PROMPT_FILE}")
    if "{catalog}" not in text:
        raise RuntimeError(f"В системном промпте нет места для каталога: {SYSTEM_PROMPT_FILE}")
    return text


def _system_prompt(catalog: str) -> str:
    return _system_prompt_template().replace("{catalog}", catalog, 1)


def _new_state() -> dict:
    return {"history": [], "done": False}


def _trim(history: list[dict]) -> list[dict]:
    """Оставить последние реплики. Режем по границе реплики клиента, чтобы не рвать пары."""
    if len(history) <= MAX_HISTORY_MESSAGES:
        return history
    tail = history[-MAX_HISTORY_MESSAGES:]
    while tail and tail[0]["role"] != "user":
        tail.pop(0)
    return tail or history[-MAX_HISTORY_MESSAGES:]


def respond(message: str, state: dict | None) -> dict:
    """Ответить клиенту и вернуть новое состояние.

    message — текст клиента как он его ввёл.
    state — состояние с прошлого шага, для нового диалога None.
    """
    text = (message or "").strip()
    state = state or _new_state()

    # Копия: state вызывающего не мутируем, даже если он передал свой словарь.
    history = list(state.get("history") or [])

    if not text:
        # Пустое сообщение — не ошибка клиента, а повод переспросить. Модель не зовём.
        return {"reply": "Напишите, пожалуйста, ваш вопрос.", "state": state, "actions": [], "done": False}

    history.append({"role": "user", "content": text})
    visible_history = _trim(history)
    query = "\n".join(item["content"] for item in visible_history[-6:])
    catalog = search_catalog(query)

    messages = [{"role": "system", "content": _system_prompt(catalog)}, *visible_history]
    reply = call_llm(messages).strip()

    history.append({"role": "assistant", "content": reply})

    new_state = {"history": history, "done": state.get("done", False)}
    logger.info("ход диалога: реплик в истории %d", len(history))

    return {"reply": reply, "state": new_state, "actions": [], "done": new_state["done"]}
