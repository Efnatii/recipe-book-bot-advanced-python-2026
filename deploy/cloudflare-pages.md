# Cloudflare Online Deploy

The project is now deployed as a full online application:

- Cloudflare D1 stores the production database.
- Cloudflare Worker exposes the API and Telegram webhook endpoint.
- Cloudflare Pages hosts the public dashboard.

## Live URLs

- Dashboard: `https://recipe-book-bot-advanced-python-2026.pages.dev/`
- API: `https://recipe-book-online-api-2026.egory780.workers.dev/`
- Telegram webhook: `https://recipe-book-online-api-2026.egory780.workers.dev/telegram/webhook`

## D1

- database name: `recipe-book-online-2026`
- database id: `5eb8c9e6-6e74-44ab-94af-a30d28e74494`
- binding: `DB`
- migrations: `migrations/`

Apply remote migrations:

```powershell
npm run db:migrate:remote
```

## Deploy

```powershell
npm run worker:deploy
npm run pages:deploy
```

## GitHub Actions

The deploy workflow requires repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The current local Wrangler OAuth session is enough for manual deploy, but it cannot be reused as a GitHub Actions API token.

## Telegram Secrets

Set Worker secrets before connecting a real Telegram bot:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Then register the webhook through Telegram Bot API with the same secret token.
