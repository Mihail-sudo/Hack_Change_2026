# Energytool AI-консультант (frontend)

React + TypeScript + Vite чат-виджет ИИ-консультанта МТС Energytool.

## Запуск

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Backend поднимается из корня репозитория: `docker compose up --build`
(API — http://localhost:8000, Swagger — http://localhost:8000/docs).

## Конфигурация

Скопируйте `.env.example` в `.env` и при необходимости поправьте значения:

| Переменная | По умолчанию | Описание |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Адрес backend API (публичная переменная, без секретов) |
| `VITE_CHAT_API` | `mock` | `mock` — локальная заглушка, `live` — реальный backend |

Файл `.env` не коммитится (см. `.gitignore`).

## React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
