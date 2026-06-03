# Cloudflare Pages Deploy

The project itself is a Python Telegram bot, so the free cloud target is limited to static documentation.
The bot runtime still needs a Telegram token and a long-running worker/host.

Manual Cloudflare Pages deploy:

```powershell
npx wrangler pages deploy docs --project-name recipe-book-bot-advanced-python-2026
```

GitHub Actions workflow `.github/workflows/cloudflare-pages.yml` requires:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

This keeps secrets outside Git and allows a free static Pages deployment when Cloudflare auth is available.
