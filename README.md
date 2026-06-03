# Recipe Book Bot

Итоговый проект для ИТ-модуля «Программирование на языке Python. Продвинутый уровень Python».

Выбранная тема: **разработка Telegram-бота "книга рецептов", а также программного обеспечения для их формирования**.

## Что реализовано

- Модульная Python-архитектура: конфигурация, ORM-модели, сервисный CRUD-слой, Telegram UI, CLI.
- SQLite-база данных на SQLAlchemy 2.x: 7 таблиц и 20+ CRUD/аналитических операций.
- Telegram-бот на aiogram 3: просмотр рецептов, поиск, карточки, избранное.
- CLI на Typer/Rich для локальной демонстрации, инициализации БД и seed-данных.
- Тестовое окружение: pytest, coverage, ruff, mypy.
- GitHub Actions: CI и публикация статической документации через GitHub Pages.
- Ручной Cloudflare Pages workflow для бесплатной публикации документации через Wrangler при наличии secrets.

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

## Проверка

```powershell
uv run ruff check .
uv run mypy src
uv run pytest
```

## Deploy

Cloudflare Pages: https://recipe-book-bot-advanced-python-2026.pages.dev/

GitHub Pages workflow публикует статическую страницу из `docs/`.

Cloudflare Pages workflow запускается вручную и требует repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Команда внутри workflow:

```powershell
npx wrangler pages deploy docs --project-name recipe-book-bot-advanced-python-2026
```
