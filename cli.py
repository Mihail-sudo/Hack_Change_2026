"""Чат с агентом в терминале.

Здесь и только здесь есть input() и print(): агент про ввод-вывод ничего не знает.
Здесь же выполняются действия, которые вернул агент (actions) — по контракту агент
сам ничего не сохраняет и не отправляет.

Запуск: python cli.py
"""

import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from agent import respond

LEADS_DIR = Path(__file__).resolve().parent / "leads"


def save_lead(lead: dict) -> Path:
    """Записать лид в leads/<id>.json. Возвращает путь к файлу.

    lead_id и created_at по контракту заполняет вызывающий код, если агент
    оставил их null. В cli.py роль вызывающего кода играем мы.
    """
    LEADS_DIR.mkdir(exist_ok=True)
    lead = dict(lead)
    lead.setdefault("lead_id", None)
    if not lead.get("lead_id"):
        lead["lead_id"] = str(uuid.uuid4())
    if not lead.get("created_at"):
        lead["created_at"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    path = LEADS_DIR / f"{lead['lead_id']}.json"
    path.write_text(json.dumps(lead, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def run_action(action: dict) -> None:
    """Выполнить действие агента. Неизвестные типы не глотаем молча."""
    kind = action.get("type")
    if kind == "handoff":
        path = save_lead(action.get("lead") or {})
        print(f"\n[лид сохранён: {path}]")
    else:
        print(f"\n[неизвестное действие: {kind!r}]")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    print("Консультант EnergyTool. Пустая строка или Ctrl+D — выход.\n")
    state = None

    while True:
        try:
            message = input("вы: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not message:
            break

        try:
            result = respond(message, state)
        except Exception as exc:  # агент упал: печатаем причину, диалог не теряем
            logging.getLogger("cli").error("агент упал: %s", exc)
            print("бот: Извините, сейчас не получается ответить. Попробуйте ещё раз.\n")
            continue

        state = result.get("state")
        print(f"бот: {result.get('reply', '')}\n")

        for action in result.get("actions") or []:
            run_action(action)

        if result.get("done"):
            print("[диалог завершён]")
            break

    return 0


if __name__ == "__main__":
    sys.exit(main())