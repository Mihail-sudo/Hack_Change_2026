# МТС Energytool — ИИ-консультант

Прототип ИИ-консультанта для сайта МТС Energytool, разработанный для Hack&Change 2026. Система помогает клиентам разобраться в энергопотреблении, учёте энергоресурсов и продуктах Energytool, отвечает по официальной базе знаний и формирует заявку для менеджера.

## Возможности

- диалог с ИИ-консультантом в веб-интерфейсе;
- поиск по базе знаний Energytool: лексический поиск и embeddings с резервным лексическим режимом;
- сохранение контекста текущей сессии и истории сообщений;
- создание нового диалога без переноса контекста из предыдущего;
- история диалогов и режим отладки;
- форма заявки с контактами и кратким резюме обращения;
- сохранение заявок в SQLite и опциональная отправка в Telegram;
- live-режим с настоящим агентом и автономный mock-режим для демонстрации интерфейса;
- поддержка любого OpenAI-совместимого API с моделью Qwen3.8-27B.

## Архитектура

```text
React frontend → FastAPI backend → Python-агент → OpenAI-совместимый API
                         │               │
                         │               └→ база знаний + BAAI/bge-m3
                         ├→ Redis: состояние активных сессий
                         ├→ SQLite: сообщения, диалоги и заявки
                         └→ Telegram: необязательное уведомление менеджера
```

Основные каталоги:

- `frontend/` — React, TypeScript и Vite;
- `backend/` — FastAPI, SQLite и работа с сессиями;
- `agent/agent/` — диалоговая логика, RAG и обращения к LLM;
- `agent/data/knowledge-base/` — база знаний Energytool;
- `agent/prompts/` — системные и диалоговые промпты;
- `agent/evals/` — проверки качества и сборка сабмита.

## Требования

Для основного сценария:

- Docker с Docker Compose;
- Node.js 22 или новее и npm;
- OpenAI-совместимый API с моделью Qwen3.8-27B.

Для запуска backend без Docker дополнительно нужны Python 3.13+ и [uv](https://docs.astral.sh/uv/).

## Получение проекта

```bash
git clone https://github.com/Mihail-sudo/Hack_Change_2026.git
cd Hack_Change_2026
git checkout main
```

## Быстрый запуск

### 1. Настройте окружение

В корне репозитория:

```bash
cp .env.example .env
```

Откройте `.env` и укажите параметры API:

```env
LLM_BASE_URL=https://polza.ai/api/v1
LLM_API_KEY=ваш_ключ
LLM_MODEL=qwen/qwen3.8-27b
EMB_MODEL=BAAI/bge-m3
```

`LLM_BASE_URL` можно заменить на адрес другого OpenAI-совместимого провайдера. Провайдер должен поддерживать endpoint `/chat/completions`; для векторного поиска также нужен endpoint `/embeddings` и модель `BAAI/bge-m3`. Если embeddings недоступны, агент продолжит работать с лексическим поиском.

Идентификатор Qwen может отличаться у разных провайдеров. Для Polza используется `qwen/qwen3.8-27b`.

Не публикуйте `.env` и API-ключи: файл добавлен в `.gitignore`.

### 2. Запустите backend и Redis

```bash
docker compose up --build -d
```

Проверьте состояние:

```bash
curl http://localhost:8000/health
docker compose ps
```

Ожидаемый ответ healthcheck содержит `"status":"ok"`.

### 3. Запустите frontend

Во втором терминале из корня репозитория:

```bash
npm --prefix frontend ci
VITE_CHAT_API=live VITE_API_BASE_URL=http://localhost:8000 npm --prefix frontend run dev
```

Откройте:

- интерфейс: http://127.0.0.1:5173;
- backend: http://localhost:8000;
- Swagger API: http://localhost:8000/docs.

В live-режиме под сообщением ввода не должно быть значка «Демо». Ответы отправляются в `POST /chat` и формируются настоящим агентом.

### 4. Остановка

Frontend останавливается сочетанием `Ctrl+C`. Backend и Redis:

```bash
docker compose down
```

SQLite и Redis используют Docker volumes, поэтому данные сохраняются между перезапусками.

## Запуск без Docker

### Backend

Требуются Python 3.13+ и uv. Из корня репозитория:

```bash
uv sync --frozen
SESSION_BACKEND=memory PYTHONPATH=agent uv run fastapi dev backend/main.py --host 0.0.0.0 --port 8000
```

`SESSION_BACKEND=memory` позволяет запустить backend без Redis, но состояние сессий пропадёт после перезапуска процесса. SQLite с диалогами и заявками сохраняется в `backend/data/leads.db`.

Для постоянного хранения состояния сессий запустите Redis отдельно и используйте:

```bash
SESSION_BACKEND=redis REDIS_URL=redis://localhost:6379/0 PYTHONPATH=agent uv run fastapi dev backend/main.py --host 0.0.0.0 --port 8000
```

### Frontend

Во втором терминале:

```bash
npm --prefix frontend ci
VITE_CHAT_API=live VITE_API_BASE_URL=http://localhost:8000 npm --prefix frontend run dev
```

## Демонстрационный режим без backend

Mock-режим не обращается к LLM и базе знаний. Он предназначен только для демонстрации интерфейса и сценарных ответов:

```bash
npm --prefix frontend ci
VITE_CHAT_API=mock npm --prefix frontend run dev
```

В этом режиме отображается значок «Демо», а заявки сохраняются только в памяти браузера.

## Настройки backend

| Переменная | Назначение | Значение по умолчанию |
|---|---|---|
| `LLM_BASE_URL` | Базовый URL OpenAI-совместимого API | `https://polza.ai/api/v1` |
| `LLM_API_KEY` | Ключ API | обязательна для live-режима |
| `LLM_MODEL` | Идентификатор генеративной модели | `qwen/qwen3.8-27b` в шаблоне |
| `EMB_MODEL` | Модель embeddings | `BAAI/bge-m3` |
| `EMBEDDER_API_KEY` | Отдельный ключ embeddings, если требуется | используется `LLM_API_KEY` |
| `LLM_TIMEOUT_SECONDS` | Таймаут одного запроса к модели | `8` в Docker Compose |
| `LLM_MAX_ATTEMPTS` | Максимум попыток запроса | `2` в Docker Compose |
| `SESSION_BACKEND` | Хранилище состояния: `redis` или `memory` | `redis` |
| `REDIS_URL` | Адрес Redis | `redis://redis:6379/0` в Docker |
| `SESSION_TTL_SECONDS` | Время жизни состояния сессии | `3600` |
| `LEADS_DB_PATH` | Путь к SQLite | `/app/backend/data/leads.db` в Docker |
| `CORS_ORIGINS` | Разрешённые источники frontend | `["*"]` |

При развёртывании на отдельном домене укажите в `VITE_API_BASE_URL` публичный адрес backend, а в `CORS_ORIGINS` — адрес frontend.

### Telegram-уведомления

По умолчанию заявки только сохраняются в SQLite. Чтобы дополнительно отправлять их менеджеру в Telegram, заполните в `.env`:

```env
TELEGRAM_BOT_TOKEN=токен_бота
TELEGRAM_CHAT_ID=id_чата
```

Если Telegram не настроен или временно недоступен, заявка всё равно сохраняется в базе.

## Настройки frontend

| Переменная | Назначение |
|---|---|
| `VITE_CHAT_API=live` | Использовать FastAPI и настоящего агента |
| `VITE_CHAT_API=mock` | Использовать локальную демонстрационную заглушку |
| `VITE_API_BASE_URL` | Базовый URL backend; по умолчанию `http://localhost:8000` |

## Основные API

| Метод и путь | Назначение |
|---|---|
| `POST /chat` | Отправить сообщение агенту |
| `GET /chat/{session_id}/messages` | Получить историю сообщений сессии |
| `POST /chat/reset` | Сбросить активное состояние сессии |
| `POST /leads` | Создать заявку |
| `GET /admin/dialogs` | Получить список диалогов |
| `GET /health` | Проверить работоспособность backend |
| `GET /docs` | Открыть Swagger-документацию |

Пример запроса к агенту:

```bash
curl -X POST http://localhost:8000/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"example-session-01","message":"Что такое ценовая категория электроэнергии?"}'
```

Пример заявки с вымышленными данными:

```bash
curl -X POST http://localhost:8000/leads \
  -H 'Content-Type: application/json' \
  -d '{"question":"Консультация по учёту электроэнергии","name":"Тестовый пользователь","contact":"+7 000 000-00-00","contact_type":"phone"}'
```

## Проверки проекта

Frontend:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test:run
VITE_CHAT_API=live npm --prefix frontend run build
```

Проверка синтаксиса Python:

```bash
python -m compileall -q backend agent
```

Для просмотра production-сборки:

```bash
VITE_CHAT_API=live VITE_API_BASE_URL=http://localhost:8000 npm --prefix frontend run build
npm --prefix frontend run preview
```

Preview по умолчанию доступен на http://localhost:4173.

## Терминальный агент и оценка качества

Для работы агента без веб-интерфейса:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r agent/requirements.txt
python agent/cli.py
```

Прогон стенда и сборка ZIP-сабмита выполняются из каталога `agent`:

```bash
cd agent
python evals/run_evals.py
python evals/build_submission.py
```

Эти команды могут выполнять платные запросы к настроенному LLM API. Архив создаётся в `agent/evals/results/submission.zip`.

При проверке на платформе хакатона адрес API, ключ и идентификатор Qwen3.8-27B передаются автоматически через переменные окружения. `BAAI/bge-m3` разрешена регламентом для embeddings; собственные ключи на платформе не нужны.

## Устранение неполадок

- **В интерфейсе отображается «Демо»**: frontend запущен без `VITE_CHAT_API=live`. Перезапустите его с переменными из раздела быстрого запуска.
- **`ModuleNotFoundError: No module named 'agent'`**: для локального backend добавьте `PYTHONPATH=agent`. В Docker это уже настроено.
- **Backend не запускается или не отвечает**: выполните `docker compose logs --tail=100 backend` и проверьте `docker compose ps`.
- **`Port 5173 is already in use`**: frontend уже запущен в другом терминале — откройте http://127.0.0.1:5173 или остановите старый процесс сочетанием `Ctrl+C`. Для запуска дополнительного экземпляра используйте `npm --prefix frontend run dev -- --port 5174`.
- **Ошибка 401 от LLM**: проверьте `LLM_API_KEY` и адрес `LLM_BASE_URL`; не выводите ключ в логи.
- **Техническая заглушка вместо ответа**: проверьте доступность модели и логи backend. В Docker предусмотрены таймаут 8 секунд и одна повторная попытка.
- **Поиск сообщает о недоступности embeddings**: система использует лексический резервный режим. Для векторного поиска проверьте `/embeddings`, `EMB_MODEL` и ключ провайдера.
- **Браузер не может обратиться к API**: проверьте `VITE_API_BASE_URL`, `CORS_ORIGINS` и доступность http://localhost:8000/health.
- **Заявка сохранена, но не пришла в Telegram**: проверьте `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` и логи backend.
