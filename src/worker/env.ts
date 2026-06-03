export type RuntimeEnv = {
  DB: D1Database;
  PUBLIC_SITE_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
};
