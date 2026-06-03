# Развертывание Cloudflare

Проект опубликован через сервисы Cloudflare:

- D1 хранит рецепты, пользователей, избранное и оценки.
- Worker предоставляет HTTP API и endpoint Telegram webhook.
- Pages публикует web-клиент из каталога `docs/`.

## Адреса

- Web-панель: `https://recipe-book-bot-advanced-python-2026.pages.dev/`
- API: `https://recipe-book-online-api-2026.egory780.workers.dev/`
- Telegram webhook: `https://recipe-book-online-api-2026.egory780.workers.dev/telegram/webhook`

## D1

- database name: `recipe-book-online-2026`
- database id: `5eb8c9e6-6e74-44ab-94af-a30d28e74494`
- binding: `DB`
- migrations: `migrations/`

Применение миграций:

```powershell
npm run db:migrate:remote
```

## Публикация

```powershell
npm run worker:deploy
npm run pages:deploy
```

## GitHub Actions

Workflow `Cloudflare Deploy` запускается вручную. Для запуска из GitHub нужны repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Локальная авторизация Wrangler используется только на этой машине и не переносится в GitHub.

## Telegram

Перед подключением webhook задаются Worker secrets:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Затем webhook регистрируется в Telegram Bot API с тем же secret token.
