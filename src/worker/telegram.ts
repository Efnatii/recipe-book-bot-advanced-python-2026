import { HttpError, json, readJson } from "./http";
import {
  addFavorite,
  ensureUser,
  getRecipe,
  rateRecipe,
  searchRecipes,
} from "./repository";
import type { RuntimeEnv } from "./env";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  chat?: { id?: number };
  text?: string;
  from?: TelegramUser;
};

type TelegramUpdate = {
  message?: TelegramMessage;
};

export async function handleTelegramWebhook(
  request: Request,
  env: RuntimeEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  await assertTelegramSecret(request, env);
  const update = parseTelegramUpdate(await readJson(request));
  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim() ?? "";
  if (chatId === undefined || text.length === 0) {
    return json({ ok: true, skipped: true });
  }
  const reply = await buildReply(env.DB, text, message?.from);
  const token = env.TELEGRAM_BOT_TOKEN;
  if (token === undefined || token.length === 0) {
    return json({ ok: true, delivered: false, reply }, 202);
  }
  ctx.waitUntil(sendTelegramMessage(token, chatId, reply));
  return json({ ok: true, delivered: true });
}

async function buildReply(
  db: D1Database,
  text: string,
  user: TelegramUser | undefined,
): Promise<string> {
  if (text === "/start") {
    if (user !== undefined) {
      await ensureUser(db, {
        telegramId: user.id,
        fullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram user",
        username: user.username ?? null,
      });
    }
    return [
      "Книга рецептов онлайн.",
      "Команды:",
      "/recipes - список рецептов",
      "/search текст - поиск",
      "/recipe 1 - карточка рецепта",
      "/favorite 1 - добавить в избранное",
      "/rate 1 5 - оценить рецепт",
    ].join("\n");
  }
  if (text === "/recipes") {
    const recipes = await searchRecipes(db, { query: "", categoryId: null, limit: 10 });
    return recipes.map((recipe) => `${recipe.id}. ${recipe.title} (${recipe.category})`).join("\n");
  }
  if (text.startsWith("/search ")) {
    const query = text.slice("/search ".length);
    const recipes = await searchRecipes(db, { query, categoryId: null, limit: 10 });
    return recipes.length === 0
      ? "Ничего не найдено."
      : recipes.map((recipe) => `${recipe.id}. ${recipe.title}`).join("\n");
  }
  if (text.startsWith("/recipe ")) {
    const recipeId = parseCommandInt(text, "/recipe ");
    const recipe = await getRecipe(db, recipeId);
    if (recipe === null) {
      return "Рецепт не найден.";
    }
    const ingredients = recipe.ingredients
      .map((item) => `- ${item.name}: ${item.quantity} ${item.unit}`)
      .join("\n");
    return [
      `${recipe.title}`,
      `${recipe.description}`,
      `Категория: ${recipe.category}`,
      `Время: ${recipe.cookingMinutes} мин.`,
      `Ингредиенты:`,
      ingredients,
      `Инструкция: ${recipe.instructions}`,
    ].join("\n");
  }
  if (text.startsWith("/favorite ")) {
    const recipeId = parseCommandInt(text, "/favorite ");
    if (user === undefined) {
      return "Telegram user не определён.";
    }
    await ensureUser(db, {
      telegramId: user.id,
      fullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram user",
      username: user.username ?? null,
    });
    await addFavorite(db, user.id, recipeId);
    return "Рецепт добавлен в избранное.";
  }
  if (text.startsWith("/rate ")) {
    const parts = text.split(/\s+/);
    const recipeId = Number(parts[1]);
    const stars = Number(parts[2]);
    if (!Number.isInteger(recipeId) || !Number.isInteger(stars)) {
      return "Формат: /rate 1 5";
    }
    if (user === undefined) {
      return "Telegram user не определён.";
    }
    await ensureUser(db, {
      telegramId: user.id,
      fullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram user",
      username: user.username ?? null,
    });
    await rateRecipe(db, user.id, recipeId, { stars, comment: "Оценка из Telegram" });
    return "Оценка сохранена.";
  }
  return "Неизвестная команда. Используйте /recipes, /search текст, /recipe 1.";
}

async function assertTelegramSecret(request: Request, env: RuntimeEnv): Promise<void> {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (expected === undefined || expected.length === 0) {
    return;
  }
  const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!(await constantTimeEqual(provided, expected))) {
    throw new HttpError(401, "Invalid Telegram webhook secret");
  }
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

async function sendTelegramMessage(token: string, chatId: number, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) {
    console.log(
      JSON.stringify({
        event: "telegram_send_failed",
        status: response.status,
      }),
    );
  }
}

function parseTelegramUpdate(value: unknown): TelegramUpdate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Telegram update object expected");
  }
  return value;
}

function parseCommandInt(text: string, prefix: string): number {
  const value = Number(text.slice(prefix.length).trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, "Command argument must be a positive integer");
  }
  return value;
}
