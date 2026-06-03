# Recipe Book Bot

Итоговый проект для ИТ-модуля «Программирование на языке Python. Продвинутый уровень Python».

Выбранная тема: **разработка Telegram-бота "книга рецептов", а также программного обеспечения для их формирования**.

## Что реализовано

- Модульная Python-архитектура: конфигурация, ORM-модели, сервисный CRUD-слой, Telegram UI, CLI.
- SQLite-база данных на SQLAlchemy 2.x: 7 таблиц и 20+ CRUD/аналитических операций.
- Telegram-бот на aiogram 3: просмотр рецептов, поиск, карточки, избранное.
- CLI на Typer/Rich для локальной демонстрации, инициализации БД и seed-данных.
- Полностью онлайн-слой на Cloudflare: Worker API, D1 database, Telegram webhook endpoint и Pages dashboard.
- Тестовое окружение: pytest, coverage, ruff, mypy.
- GitHub Actions: CI с ruff, mypy, pytest и TypeScript typecheck.
- Cloudflare Pages: бесплатная публикация рабочего web-клиента из `docs/`.

## Быстрый старт

```powershell
uv sync --dev
uv run recipe-book-bot init-db
uv run recipe-book-bot seed
uv run recipe-book-bot list-recipes
uv run recipe-book-bot demo
```

Для запуска реального Telegram-бота создайте `.env` по примеру `.env.example` и задайте `RECIPE_BOOK_TELEGRAM_TOKEN`.

```powershell
uv run recipe-book-bot run-bot
```

Онлайн-слой запускается через Cloudflare:

```powershell
npm install
npm run typecheck
npm run db:migrate:remote
npm run worker:deploy
npm run pages:deploy
```

## Архитектура

```text
recipe_book_bot/
  config.py          настройки окружения
  db.py              engine/session/init БД
  models.py          SQLAlchemy ORM-модели
  schemas.py         pydantic-схемы входных данных
  services.py        CRUD и бизнес-операции
  seed.py            демонстрационные данные
  cli.py             локальный CLI
  bot/               aiogram router, handlers, keyboards
worker/
  index.ts           Cloudflare Worker API routes
  repository.ts      D1 SQL CRUD layer
  telegram.ts        Telegram webhook adapter
  validation.ts      JSON input validation
docs/
  index.html         online dashboard
  assets/app.js      browser client for Worker API
```

## База данных

Таблицы:

1. `users`
2. `categories`
3. `ingredients`
4. `recipes`
5. `recipe_ingredients`
6. `favorites`
7. `ratings`

Локальная учебная БД создаётся как SQLite-файл `data/recipe_book.sqlite3`.
Онлайн-БД развёрнута в Cloudflare D1:

- database name: `recipe-book-online-2026`
- database id: `5eb8c9e6-6e74-44ab-94af-a30d28e74494`
- binding: `DB`

## Проверка

```powershell
uv run ruff check .
uv run mypy src
uv run pytest
npm run typecheck
```

## Deploy

Cloudflare Pages dashboard: https://recipe-book-bot-advanced-python-2026.pages.dev/

Cloudflare Worker API: https://recipe-book-online-api-2026.egory780.workers.dev/

Онлайн-проект состоит из:

- Cloudflare D1 database для постоянного хранения рецептов, пользователей, избранного и рейтингов.
- Cloudflare Worker API для CRUD, статистики и Telegram webhook.
- Cloudflare Pages dashboard как публичный клиент.

Ручной deploy:

```powershell
npm run db:migrate:remote
npm run worker:deploy
npm run pages:deploy
```

Для полноценного Telegram webhook нужно добавить Cloudflare Worker secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

Webhook URL: `https://recipe-book-online-api-2026.egory780.workers.dev/telegram/webhook`
