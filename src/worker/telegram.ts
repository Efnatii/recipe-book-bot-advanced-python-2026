import type { RuntimeEnv } from "./env";
import { HttpError, json, readJson } from "./http";
import {
  addFavorite,
  ensureUser,
  getRecipe,
  listCategories,
  listFavorites,
  rateRecipe,
  removeFavorite,
  searchRecipes,
  type RecipeDetails,
  type RecipeSummary,
} from "./repository";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  chat?: { id?: number };
  message_id?: number;
  text?: string;
  from?: TelegramUser;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type InlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

type TelegramReply = {
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
};

type CallbackResult = {
  reply: TelegramReply;
  notice?: string;
  showAlert?: boolean;
};

const DASHBOARD_URL = "https://recipe-book-bot-advanced-python-2026.pages.dev/";

export async function handleTelegramWebhook(
  request: Request,
  env: RuntimeEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  await assertTelegramSecret(request, env);
  const update = parseTelegramUpdate(await readJson(request));
  const token = env.TELEGRAM_BOT_TOKEN;

  if (update.callback_query !== undefined) {
    const result = await handleCallbackUpdate(env.DB, update.callback_query, env);
    if (token === undefined || token.length === 0) {
      return json({ ok: true, delivered: false, result }, 202);
    }
    ctx.waitUntil(deliverCallbackResult(token, update.callback_query, result));
    return json({ ok: true, delivered: true, mode: "callback" });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim() ?? "";
  if (chatId === undefined || text.length === 0) {
    return json({ ok: true, skipped: true });
  }

  const reply = await buildMessageReply(env.DB, text, message?.from, env);
  if (token === undefined || token.length === 0) {
    return json({ ok: true, delivered: false, reply }, 202);
  }
  ctx.waitUntil(sendTelegramMessage(token, chatId, reply));
  return json({ ok: true, delivered: true, mode: "message" });
}

async function handleCallbackUpdate(
  db: D1Database,
  callback: TelegramCallbackQuery,
  env: RuntimeEnv,
): Promise<CallbackResult> {
  await ensureTelegramUser(db, callback.from);
  return buildCallbackReply(db, callback.data ?? "menu", callback.from, env);
}

async function buildMessageReply(
  db: D1Database,
  text: string,
  user: TelegramUser | undefined,
  env: RuntimeEnv,
): Promise<TelegramReply> {
  if (user !== undefined) {
    await ensureTelegramUser(db, user);
  }

  const lower = text.toLowerCase();
  if (lower === "/start" || lower === "/help" || lower === "меню") {
    return mainMenuReply(env);
  }
  if (lower === "/recipes" || lower === "рецепты") {
    return recipesReply(db, { title: "Рецепты", query: "", categoryId: null });
  }
  if (lower === "/categories" || lower === "категории") {
    return categoriesReply(db);
  }
  if (lower === "/favorites" || lower === "избранное") {
    if (user === undefined) {
      return unknownUserReply();
    }
    return favoritesReply(db, user);
  }
  if (lower.startsWith("/recipe ")) {
    return recipeCardReply(db, parseCommandInt(text, "/recipe "));
  }
  if (lower.startsWith("/search ")) {
    const query = text.slice("/search ".length).trim();
    return recipesReply(db, { title: `Поиск: ${query}`, query, categoryId: null });
  }
  if (lower.startsWith("/favorite ")) {
    if (user === undefined) {
      return unknownUserReply();
    }
    const recipeId = parseCommandInt(text, "/favorite ");
    await addFavorite(db, user.id, recipeId);
    return recipeCardReply(db, recipeId, "Добавлено в избранное");
  }
  if (lower.startsWith("/rate ")) {
    if (user === undefined) {
      return unknownUserReply();
    }
    const parts = text.split(/\s+/);
    const recipeId = parseCallbackInt(parts[1], "recipeId");
    const stars = parseStars(parts[2]);
    await rateRecipe(db, user.id, recipeId, { stars, comment: "Оценка из Telegram" });
    return recipeCardReply(db, recipeId, `Оценка ${stars}/5 сохранена`);
  }
  if (text.startsWith("/")) {
    return mainMenuReply(env, "Команда не распознана. Выберите действие кнопками.");
  }
  return recipesReply(db, { title: `Поиск: ${text}`, query: text, categoryId: null });
}

async function buildCallbackReply(
  db: D1Database,
  data: string,
  user: TelegramUser,
  env: RuntimeEnv,
): Promise<CallbackResult> {
  if (data === "menu") {
    return { reply: mainMenuReply(env), notice: "Меню" };
  }
  if (data === "recipes") {
    return {
      reply: await recipesReply(db, { title: "Рецепты", query: "", categoryId: null }),
      notice: "Рецепты",
    };
  }
  if (data === "categories") {
    return { reply: await categoriesReply(db), notice: "Категории" };
  }
  if (data === "favorites") {
    return { reply: await favoritesReply(db, user), notice: "Избранное" };
  }
  if (data === "search_help") {
    return { reply: searchHelpReply(env), notice: "Поиск" };
  }
  if (data.startsWith("category:")) {
    const categoryId = parseCallbackInt(data.split(":")[1], "categoryId");
    const categories = await listCategories(db);
    const category = categories.find((item) => item.id === categoryId);
    return {
      reply: await recipesReply(db, {
        title: category === undefined ? "Категория" : category.name,
        query: "",
        categoryId,
      }),
      notice: "Категория",
    };
  }
  if (data.startsWith("recipe:")) {
    return {
      reply: await recipeCardReply(db, parseCallbackInt(data.split(":")[1], "recipeId")),
      notice: "Карточка",
    };
  }
  if (data.startsWith("favorite:")) {
    const recipeId = parseCallbackInt(data.split(":")[1], "recipeId");
    await addFavorite(db, user.id, recipeId);
    return {
      reply: await recipeCardReply(db, recipeId, "Добавлено в избранное"),
      notice: "Добавлено",
    };
  }
  if (data.startsWith("unfavorite:")) {
    const recipeId = parseCallbackInt(data.split(":")[1], "recipeId");
    await removeFavorite(db, user.id, recipeId);
    return { reply: await favoritesReply(db, user), notice: "Удалено" };
  }
  if (data.startsWith("rate_menu:")) {
    const recipeId = parseCallbackInt(data.split(":")[1], "recipeId");
    return { reply: await ratingReply(db, recipeId), notice: "Оценка" };
  }
  if (data.startsWith("rate:")) {
    const parts = data.split(":");
    const recipeId = parseCallbackInt(parts[1], "recipeId");
    const stars = parseStars(parts[2]);
    await rateRecipe(db, user.id, recipeId, { stars, comment: "Оценка из Telegram" });
    return {
      reply: await recipeCardReply(db, recipeId, `Оценка ${stars}/5 сохранена`),
      notice: "Оценка сохранена",
    };
  }
  return {
    reply: mainMenuReply(env, "Действие больше недоступно. Вернитесь в меню."),
    notice: "Обновите меню",
    showAlert: true,
  };
}

function mainMenuReply(env: RuntimeEnv, lead = "Выберите действие кнопками ниже."): TelegramReply {
  return {
    text: [
      "<b>Книга рецептов</b>",
      escapeHtml(lead),
      "",
      "Без команд и ручного ввода: рецепты, категории, избранное и оценки доступны через меню.",
    ].join("\n"),
    replyMarkup: mainMenuKeyboard(env),
  };
}

function searchHelpReply(env: RuntimeEnv): TelegramReply {
  return {
    text: [
      "<b>Поиск рецептов</b>",
      "Напишите название блюда или ингредиент обычным сообщением.",
      "",
      "Примеры: <code>паста</code>, <code>гречка</code>, <code>сырники</code>.",
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [{ text: "Все рецепты", callback_data: "recipes" }],
        bottomMenuRow(env),
      ],
    },
  };
}

async function recipesReply(
  db: D1Database,
  options: { title: string; query: string; categoryId: number | null },
): Promise<TelegramReply> {
  const recipes = await searchRecipes(db, {
    query: options.query,
    categoryId: options.categoryId,
    limit: 10,
  });
  if (recipes.length === 0) {
    return {
      text: `<b>${escapeHtml(options.title)}</b>\nНичего не найдено.`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Все рецепты", callback_data: "recipes" }],
          [{ text: "Категории", callback_data: "categories" }],
          [{ text: "Главное меню", callback_data: "menu" }],
        ],
      },
    };
  }
  return {
    text: [
      `<b>${escapeHtml(options.title)}</b>`,
      `Найдено: ${recipes.length}. Откройте карточку рецепта кнопкой ниже.`,
      "",
      recipes.map(recipeSummaryLine).join("\n"),
    ].join("\n"),
    replyMarkup: recipeListKeyboard(recipes),
  };
}

async function categoriesReply(db: D1Database): Promise<TelegramReply> {
  const categories = await listCategories(db);
  const rows = chunkButtons(
    categories.map((category) => ({
      text: category.name,
      callback_data: `category:${category.id}`,
    })),
    2,
  );
  rows.push([{ text: "Все рецепты", callback_data: "recipes" }]);
  rows.push([{ text: "Главное меню", callback_data: "menu" }]);
  return {
    text: "<b>Категории</b>\nВыберите категорию, чтобы отфильтровать рецепты.",
    replyMarkup: { inline_keyboard: rows },
  };
}

async function favoritesReply(db: D1Database, user: TelegramUser): Promise<TelegramReply> {
  const favorites = await listFavorites(db, user.id);
  if (favorites.length === 0) {
    return {
      text: "<b>Избранное</b>\nПока пусто. Откройте рецепт и нажмите «В избранное».",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Открыть рецепты", callback_data: "recipes" }],
          [{ text: "Главное меню", callback_data: "menu" }],
        ],
      },
    };
  }
  return {
    text: [
      "<b>Избранное</b>",
      "Откройте карточку или удалите рецепт из списка.",
      "",
      favorites.map(recipeSummaryLine).join("\n"),
    ].join("\n"),
    replyMarkup: favoriteListKeyboard(favorites),
  };
}

async function recipeCardReply(
  db: D1Database,
  recipeId: number,
  notice?: string,
): Promise<TelegramReply> {
  const recipe = await getRecipe(db, recipeId);
  if (recipe === null) {
    return {
      text: "<b>Рецепт не найден</b>",
      replyMarkup: { inline_keyboard: [[{ text: "Все рецепты", callback_data: "recipes" }]] },
    };
  }
  return {
    text: recipeCardText(recipe, notice),
    replyMarkup: recipeActionKeyboard(recipe.id),
  };
}

async function ratingReply(db: D1Database, recipeId: number): Promise<TelegramReply> {
  const recipe = await getRecipe(db, recipeId);
  if (recipe === null) {
    return {
      text: "<b>Рецепт не найден</b>",
      replyMarkup: { inline_keyboard: [[{ text: "Все рецепты", callback_data: "recipes" }]] },
    };
  }
  return {
    text: `<b>${escapeHtml(recipe.title)}</b>\nВыберите оценку:`,
    replyMarkup: ratingKeyboard(recipe.id),
  };
}

function unknownUserReply(): TelegramReply {
  return {
    text: "<b>Не удалось определить Telegram-пользователя.</b>\nНажмите /start и повторите действие.",
    replyMarkup: { inline_keyboard: [[{ text: "Главное меню", callback_data: "menu" }]] },
  };
}

function mainMenuKeyboard(env: RuntimeEnv): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Рецепты", callback_data: "recipes" }],
      [
        { text: "Категории", callback_data: "categories" },
        { text: "Избранное", callback_data: "favorites" },
      ],
      [
        { text: "Поиск", callback_data: "search_help" },
        { text: "Dashboard", url: dashboardUrl(env) },
      ],
    ],
  };
}

function recipeListKeyboard(recipes: RecipeSummary[]): InlineKeyboardMarkup {
  const rows = recipes.map((recipe) => [
    { text: recipeButtonTitle(recipe), callback_data: `recipe:${recipe.id}` },
  ]);
  rows.push([{ text: "Категории", callback_data: "categories" }]);
  rows.push([{ text: "Главное меню", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function favoriteListKeyboard(recipes: RecipeSummary[]): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  for (const recipe of recipes) {
    rows.push([{ text: recipeButtonTitle(recipe), callback_data: `recipe:${recipe.id}` }]);
    rows.push([{ text: `Удалить: ${recipe.title}`, callback_data: `unfavorite:${recipe.id}` }]);
  }
  rows.push([{ text: "Все рецепты", callback_data: "recipes" }]);
  rows.push([{ text: "Главное меню", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function recipeActionKeyboard(recipeId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "В избранное", callback_data: `favorite:${recipeId}` },
        { text: "Оценить", callback_data: `rate_menu:${recipeId}` },
      ],
      [
        { text: "Все рецепты", callback_data: "recipes" },
        { text: "Главное меню", callback_data: "menu" },
      ],
    ],
  };
}

function ratingKeyboard(recipeId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [1, 2, 3, 4, 5].map((stars) => ({
        text: `${stars}`,
        callback_data: `rate:${recipeId}:${stars}`,
      })),
      [{ text: "Назад к рецепту", callback_data: `recipe:${recipeId}` }],
    ],
  };
}

function bottomMenuRow(env: RuntimeEnv): InlineKeyboardButton[] {
  return [
    { text: "Главное меню", callback_data: "menu" },
    { text: "Dashboard", url: dashboardUrl(env) },
  ];
}

function chunkButtons(
  buttons: InlineKeyboardButton[],
  size: number,
): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  for (let index = 0; index < buttons.length; index += size) {
    rows.push(buttons.slice(index, index + size));
  }
  return rows;
}

function recipeSummaryLine(recipe: RecipeSummary): string {
  const rating = recipe.averageRating === null ? "без оценок" : `${recipe.averageRating}/5`;
  return [
    `<b>${escapeHtml(recipe.title)}</b>`,
    `${escapeHtml(recipe.category)} · ${recipe.cookingMinutes} мин · ${escapeHtml(recipe.difficulty)}`,
    `Рейтинг: ${rating}`,
  ].join("\n");
}

function recipeButtonTitle(recipe: RecipeSummary): string {
  const rating = recipe.averageRating === null ? "" : ` · ${recipe.averageRating}/5`;
  return `${recipe.title} · ${recipe.cookingMinutes} мин${rating}`;
}

function recipeCardText(recipe: RecipeDetails, notice?: string): string {
  const ingredients = recipe.ingredients
    .map((item) => {
      const note = item.note === null ? "" : ` (${escapeHtml(item.note)})`;
      return `- ${escapeHtml(item.name)}: ${formatQuantity(item.quantity)} ${escapeHtml(item.unit)}${note}`;
    })
    .join("\n");
  const rating =
    recipe.averageRating === null
      ? "нет оценок"
      : `${recipe.averageRating}/5 (${recipe.ratingCount} оцен.)`;
  const prefix = notice === undefined ? "" : `<b>${escapeHtml(notice)}</b>\n\n`;
  return [
    `${prefix}<b>${escapeHtml(recipe.title)}</b>`,
    `${escapeHtml(recipe.category)} · ${recipe.cookingMinutes} мин · ${escapeHtml(recipe.difficulty)}`,
    `Рейтинг: ${rating}`,
    "",
    escapeHtml(recipe.description),
    "",
    "<b>Ингредиенты</b>",
    ingredients,
    "",
    "<b>Шаги</b>",
    escapeHtml(trimText(recipe.instructions, 900)),
  ].join("\n");
}

async function ensureTelegramUser(
  db: D1Database,
  user: TelegramUser,
): Promise<void> {
  await ensureUser(db, {
    telegramId: user.id,
    fullName: [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram user",
    username: user.username ?? null,
  });
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

async function sendTelegramMessage(
  token: string,
  chatId: number,
  reply: TelegramReply,
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: reply.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(reply.replyMarkup === undefined ? {} : { reply_markup: reply.replyMarkup }),
    }),
  });
  if (!response.ok) {
    await logTelegramFailure("telegram_send_failed", response);
  }
}

async function deliverCallbackResult(
  token: string,
  callback: TelegramCallbackQuery,
  result: CallbackResult,
): Promise<void> {
  await answerCallbackQuery(token, callback.id, result.notice, result.showAlert);
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (chatId === undefined || messageId === undefined) {
    return;
  }
  await editTelegramMessage(token, chatId, messageId, result.reply);
}

async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text: string | undefined,
  showAlert: boolean | undefined,
): Promise<void> {
  const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text !== undefined) {
    body.text = text;
  }
  if (showAlert !== undefined) {
    body.show_alert = showAlert;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await logTelegramFailure("telegram_callback_answer_failed", response);
  }
}

async function editTelegramMessage(
  token: string,
  chatId: number,
  messageId: number,
  reply: TelegramReply,
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: reply.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(reply.replyMarkup === undefined ? {} : { reply_markup: reply.replyMarkup }),
    }),
  });
  if (!response.ok) {
    await logTelegramFailure("telegram_edit_failed", response);
  }
}

async function logTelegramFailure(event: string, response: Response): Promise<void> {
  console.log(
    JSON.stringify({
      event,
      status: response.status,
      body: await response.text(),
    }),
  );
}

function parseTelegramUpdate(value: unknown): TelegramUpdate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Telegram update object expected");
  }
  return value;
}

function parseCommandInt(text: string, prefix: string): number {
  return parseCallbackInt(text.slice(prefix.length).trim(), "command argument");
}

function parseCallbackInt(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer`);
  }
  return parsed;
}

function parseStars(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new HttpError(400, "stars must be an integer from 1 to 5");
  }
  return parsed;
}

function dashboardUrl(env: RuntimeEnv): string {
  return env.PUBLIC_SITE_URL ?? DASHBOARD_URL;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
