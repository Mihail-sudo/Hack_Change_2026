# LLM Consultant Backend

Прототип backend для LLM-консультанта: FastAPI + поиск по базе знаний + OpenAI-совместимая LLM с fallback-режимом без ключа.

## Запуск

```bash
uv sync
uv run fastapi dev backend/main.py
```

Сервер: <http://127.0.0.1:8000>, Swagger: <http://127.0.0.1:8000/docs>.

Альтернативы:

```bash
uv run python backend/main.py
uv run uvicorn main:app --app-dir backend --reload
```

## Настройка LLM

Скопируйте `backend/.env.example` в `.env` или `backend/.env` и задайте:

```bash
LLM_API_KEY=...
LLM_BASE_URL=https://api.openai.com/v1   # любой OpenAI-совместимый endpoint
LLM_MODEL=gpt-4o-mini
```

Без `LLM_API_KEY` сервис работает в демо-режиме: возвращает релевантные фрагменты базы знаний и явно указывает `mode: "fallback"`. Если провайдер вернул ошибку, сервис также переключается на fallback.

## API

| Метод | Путь | Назначение |
| --- | --- | --- |
| `GET` | `/health` | Статус, наличие LLM, размер базы знаний |
| `POST` | `/api/v1/consultations` | Задать вопрос; `session_id` опционален |
| `POST` | `/api/v1/sessions` | Создать пустую сессию |
| `GET` | `/api/v1/sessions/{id}` | История сессии |
| `DELETE` | `/api/v1/sessions/{id}` | Удалить сессию |
| `GET` | `/api/v1/knowledge/search?q=...` | Поиск по базе знаний |

Пример:

```bash
SESSION_ID=$(curl -s -X POST http://127.0.0.1:8000/api/v1/sessions | uv run python -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -s -X POST http://127.0.0.1:8000/api/v1/consultations \
  -H 'Content-Type: application/json' \
  -d "{\"message\":\"Как подключить LLM?\",\"session_id\":\"$SESSION_ID\"}"
```

Ответ содержит `answer`, `session_id`, `mode` (`llm`/`fallback`), `model` и `sources`.

## Устройство

- `backend/main.py` — точка входа, экспортирует `app`.
- `backend/app/main.py` — сборка FastAPI, маршруты, lifespan.
- `backend/app/services.py` — оркестрация диалога, prompt, сессии, fallback.
- `backend/app/knowledge.py` — загрузка и keyword-поиск по JSON.
- `backend/app/llm.py` — клиент OpenAI-совместимого API.
- `backend/data/knowledge.json` — база знаний; правки применяются после перезапуска.

## Ограничения прототипа

- Сессии хранятся в памяти и теряются при перезапуске.
- Поиск по ключевым словам, без эмбеддингов и векторной БД.
- Нет аутентификации, rate limiting, персистентности и тестов.
- Не отправляйте персональные данные и секреты.

Следующие шаги для production: PostgreSQL/Redis для сессий, pgvector или Qdrant для RAG, аутентификация, лимиты, логирование и миграции.
