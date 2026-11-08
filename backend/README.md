# Backend LLM-консультанта

FastAPI-сервис для работы с векторной базой Qdrant и frontend API. Генерация ответов LLM опциональна: основной контур — документы, эмбеддинги, семантический поиск и сессии.

## Запуск

```bash
uv sync
uv run fastapi dev backend/main.py
```

- API: <http://127.0.0.1:8000>
- Swagger: <http://127.0.0.1:8000/docs>

По умолчанию используется встроенный Qdrant (`backend/data/qdrant`) и hash-эмбеддинги. Это позволяет поднять сервис без Docker и внешнего LLM-сервиса. Для реального семантического поиска включите внешние эмбеддинги.

## Эмбеддинги

Сервис не генерирует эмбеддинги сам: он вызывает OpenAI-совместимый endpoint другого сервиса.

```bash
EMBEDDING_PROVIDER=http
EMBEDDING_BASE_URL=http://llm-service:8000/v1
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
```

Контракт:

```http
POST {EMBEDDING_BASE_URL}/embeddings
{"model": "...", "input": ["текст 1", "текст 2"]}
```

Ожидается стандартный ответ `{"data": [{"index": 0, "embedding": [...]}, ...]}`.

Без внешнего сервиса используйте `EMBEDDING_PROVIDER=hash`: векторы детерминированные, но качество семантического поиска демонстрационное.

## Qdrant

Локальный режим (по умолчанию):

```bash
QDRANT_PATH=backend/data/qdrant
QDRANT_COLLECTION=knowledge
```

Подключение к запущенному Qdrant:

```bash
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=knowledge
```

Размерность вектора фиксируется при создании коллекции. При смене embedding-модели удалите локальную коллекцию (`backend/data/qdrant`) или пересоздайте коллекцию в Qdrant.

## API

Документы:

| Метод | Путь | Назначение |
| --- | --- | --- |
| `POST` | `/api/v1/documents` | Создать документ; текст режется на чанки и индексируется |
| `POST` | `/api/v1/documents/bulk` | Массовое создание, до 100 документов |
| `GET` | `/api/v1/documents?limit=&offset=` | Список документов без полного текста |
| `GET` | `/api/v1/documents/{id}` | Документ с полным текстом и `chunk_count` |
| `PUT` | `/api/v1/documents/{id}` | Обновить и переиндексировать документ |
| `DELETE` | `/api/v1/documents/{id}` | Удалить документ и все его чанки |

Поиск и знания:

| Метод | Путь | Назначение |
| --- | --- | --- |
| `POST` | `/api/v1/search` | Векторный поиск по тексту запроса |
| `GET` | `/api/v1/knowledge/stats` | Коллекция, число точек/документов, размерность |
| `POST` | `/api/v1/knowledge/seed?force=` | Загрузить seed-документы из JSON |

Диалог:

| Метод | Путь | Назначение |
| --- | --- | --- |
| `POST` | `/api/v1/consultations` | Поиск контекста + ответ LLM или fallback |
| `POST` | `/api/v1/sessions` | Создать сессию |
| `GET` | `/api/v1/sessions/{id}` | История сессии |
| `DELETE` | `/api/v1/sessions/{id}` | Удалить сессию |

Служебное: `GET /health`, `GET /`.

## Примеры

Создание документа:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/documents \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "pricing",
    "title": "Тарифы",
    "content": "Базовый тариф стоит 10 000 рублей в месяц.",
    "tags": ["тарифы", "оплата"],
    "metadata": {"source": "frontend"}
  }'
```

Поиск:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"сколько стоит базовый тариф","top_k":5,"score_threshold":0.2}'
```

Ответ поиска содержит `document_id`, `title`, `content`, `chunk_index`, `score`, `tags`, `metadata`.

Диалог:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/consultations \
  -H 'Content-Type: application/json' \
  -d '{"message":"Как подключить LLM?"}'
```

`session_id` из ответа передавайте в следующих запросах для учёта истории. Если `LLM_API_KEY` не задан, `mode` будет `"fallback"`, а в `sources` вернутся найденные чанки.

## Устройство

- `backend/main.py` — точка входа, экспортирует `app`.
- `backend/app/main.py` — создание FastAPI, lifespan, CORS, health, exception handlers.
- `backend/app/api/v1/` — роутеры документов, поиска, знаний, диалога и сессий.
- `backend/app/repositories/knowledge.py` — чанкинг, индексация и CRUD-операции поверх Qdrant.
- `backend/app/vectorstore/qdrant.py` — Qdrant: коллекция, upsert, фильтры, поиск, статистика.
- `backend/app/vectorstore/embeddings.py` — внешний embedding-клиент и hash-fallback.
- `backend/app/services.py` — сессии, prompt и fallback для диалога.
- `backend/data/knowledge.json` — seed-документы для первого запуска.

## Ограничения

- Сессии хранятся в памяти и теряются при перезапуске.
- Нет аутентификации, rate limiting и миграций.
- Hash-эмбеддинги подходят только для демо.
- Для production: JWT/API-ключи, Redis/Postgres для сессий, отдельный Qdrant, мониторинг и лимиты.
