import type { RuntimeEnv } from "./env";
import { HttpError, json, readJson } from "./http";
import {
  addFavorite,
  ensureUser,
  getUserRecipeState,
  getRecipe,
  listCategories,
  listFavorites,
  rateRecipe,
  removeFavorite,
  searchRecipes,
  type RecipeDetails,
  type RecipeSummary,
  type UserRecipeState,
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

type ReplyKeyboardMarkup = {
  keyboard: { text: string }[][];
  resize_keyboard: boolean;
  is_persistent: boolean;
  one_time_keyboard: boolean;
  selective: boolean;
  input_field_placeholder: string;
};

type TelegramReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup;

type TelegramReply = {
  text: string;
  replyMarkup?: TelegramReplyMarkup;
};

type CallbackResult = {
  reply: TelegramReply;
  notice?: string;
  showAlert?: boolean;
};

const DASHBOARD_URL = "https://recipe-book-bot-advanced-python-2026.pages.dev/";
const PAGE_SIZE = 5;
const MENU_RECIPES = "📖 Рецепты";
const MENU_CATEGORIES = "🗂 Категории";
const MENU_FAVORITES = "⭐ Избранное";
const MENU_SEARCH = "🔎 Поиск";
const MENU_HELP = "❔ Справка";
const MENU_HOME = "🏠 Меню";
const MENU_DASHBOARD = "📊 Dashboard";

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

  const command = readCommandName(text);
  const commandArgs = readCommandArgs(text);
  const menuText = normalizeMenuText(text);

  if (command === "/start" || menuText === "меню") {
    return mainMenuReply(env);
  }
  if (command === "/help" || menuText === "справка") {
    return helpReply(env);
  }
  if (command === "/recipes" || menuText === "рецепты") {
    return recipesReply(db, { title: "Рецепты", query: "", categoryId: null, offset: 0 });
  }
  if (command === "/categories" || menuText === "категории") {
    return categoriesReply(db);
  }
  if (command === "/favorites" || menuText === "избранное") {
    if (user === undefined) {
      return unknownUserReply();
    }
    return favoritesReply(db, user, 0);
  }
  if (command === "/search") {
    if (commandArgs.length === 0) {
      return searchHelpReply(env, "Напишите запрос следующим сообщением.");
    }
    return recipesReply(db, { title: `Поиск: ${commandArgs}`, query: commandArgs, categoryId: null, offset: 0 });
  }
  if (menuText === "поиск") {
    return searchHelpReply(env, "Напишите запрос следующим сообщением.");
  }
  if (menuText === "dashboard") {
    return dashboardReply(env);
  }
  if (command === "/recipe") {
    const recipeId = tryParsePositiveInt(commandArgs);
    if (recipeId === null) {
      return invalidCommandReply(env, "Используйте формат: <code>/recipe 12</code>.");
    }
    return recipeCardReply(db, recipeId, env, user);
  }
  if (command === "/favorite") {
    if (user === undefined) {
      return unknownUserReply();
    }
    const recipeId = tryParsePositiveInt(commandArgs);
    if (recipeId === null) {
      return invalidCommandReply(env, "Используйте формат: <code>/favorite 12</code>.");
    }
    if ((await getRecipe(db, recipeId)) === null) {
      return recipeNotFoundReply();
    }
    await addFavorite(db, user.id, recipeId);
    return recipeCardReply(db, recipeId, env, user, "Добавлено в избранное");
  }
  if (command === "/rate") {
    if (user === undefined) {
      return unknownUserReply();
    }
    const [recipeIdText, starsText] = commandArgs.split(/\s+/, 2);
    const recipeId = tryParsePositiveInt(recipeIdText ?? "");
    const stars = tryParseStars(starsText);
    if (recipeId === null || stars === null) {
      return invalidCommandReply(env, "Используйте формат: <code>/rate 12 5</code>.");
    }
    if ((await getRecipe(db, recipeId)) === null) {
      return recipeNotFoundReply();
    }
    await rateRecipe(db, user.id, recipeId, { stars, comment: "Оценка из Telegram" });
    return recipeCardReply(db, recipeId, env, user, `Оценка ${stars}/5 сохранена`);
  }
  if (text.startsWith("/")) {
    return mainMenuReply(env, "Команда не распознана. Выберите действие кнопками.");
  }
  return recipesReply(db, { title: `Поиск: ${text}`, query: text, categoryId: null, offset: 0 });
}

async function buildCallbackReply(
  db: D1Database,
  data: string,
  user: TelegramUser,
  env: RuntimeEnv,
): Promise<CallbackResult> {
  if (data === "menu") {
    return { reply: mainMenuReply(env, "Нижняя клавиатура включена."), notice: "Меню" };
  }
  if (data === "help") {
    return { reply: helpReply(env), notice: "Справка" };
  }
  if (data === "recipes" || data.startsWith("recipes:")) {
    const offset = parseOffset(data.split(":")[1]);
    return {
      reply: await recipesReply(db, { title: "Рецепты", query: "", categoryId: null, offset }),
      notice: "Рецепты",
    };
  }
  if (data === "categories") {
    return { reply: await categoriesReply(db), notice: "Категории" };
  }
  if (data === "favorites" || data.startsWith("favorites:")) {
    return { reply: await favoritesReply(db, user, parseOffset(data.split(":")[1])), notice: "Избранное" };
  }
  if (data === "search_help") {
    return { reply: searchHelpReply(env), notice: "Поиск" };
  }
  if (data.startsWith("category:")) {
    const parts = data.split(":");
    const categoryId = parseCallbackInt(parts[1], "categoryId");
    const offset = parseOffset(parts[2]);
    const categories = await listCategories(db);
    const category = categories.find((item) => item.id === categoryId);
    return {
      reply: await recipesReply(db, {
        title: category === undefined ? "Категория" : category.name,
        query: "",
        categoryId,
        offset,
      }),
      notice: "Категория",
    };
  }
  if (data.startsWith("recipe:")) {
    return {
      reply: await recipeCardReply(db, parseCallbackInt(data.split(":")[1], "recipeId"), env, user),
      notice: "Карточка",
    };
  }
  if (data.startsWith("favorite:")) {
    const recipeId = parseCallbackInt(data.split(":")[1], "recipeId");
    if ((await getRecipe(db, recipeId)) === null) {
      return { reply: recipeNotFoundReply(), notice: "Не найдено", showAlert: true };
    }
    await addFavorite(db, user.id, recipeId);
    return {
      reply: await recipeCardReply(db, recipeId, env, user, "Добавлено в избранное"),
      notice: "Добавлено",
    };
  }
  if (data.startsWith("remove_favorite:")) {
    const recipeId = parseCallbackInt(data.split(":")[1], "recipeId");
    await removeFavorite(db, user.id, recipeId);
    return {
      reply: await recipeCardReply(db, recipeId, env, user, "Удалено из избранного"),
      notice: "Удалено",
    };
  }
  if (data.startsWith("unfavorite:")) {
    const recipeId = parseCallbackInt(data.split(":")[1], "recipeId");
    await removeFavorite(db, user.id, recipeId);
    return { reply: await favoritesReply(db, user, 0), notice: "Удалено" };
  }
  if (data.startsWith("rate_menu:")) {
    const recipeId = parseCallbackInt(data.split(":")[1], "recipeId");
    return { reply: await ratingReply(db, recipeId), notice: "Оценка" };
  }
  if (data.startsWith("rate:")) {
    const parts = data.split(":");
    const recipeId = parseCallbackInt(parts[1], "recipeId");
    const stars = parseStars(parts[2]);
    if ((await getRecipe(db, recipeId)) === null) {
      return { reply: recipeNotFoundReply(), notice: "Не найдено", showAlert: true };
    }
    await rateRecipe(db, user.id, recipeId, { stars, comment: "Оценка из Telegram" });
    return {
      reply: await recipeCardReply(db, recipeId, env, user, `Оценка ${stars}/5 сохранена`),
      notice: "Оценка сохранена",
    };
  }
  return {
    reply: mainMenuReply(env, "Действие больше недоступно. Нижняя клавиатура включена."),
    notice: "Обновите меню",
    showAlert: true,
  };
}

function mainMenuReply(
  env: RuntimeEnv,
  lead = "Выберите раздел на нижней клавиатуре.",
  mode: "reply" | "inline" = "reply",
): TelegramReply {
  return {
    text: [
      "<b>Книга рецептов</b>",
      escapeHtml(lead),
      "",
      "Каталог, категории, избранное, поиск и оценки доступны кнопками.",
    ].join("\n"),
    replyMarkup: mode === "reply" ? replyMenuKeyboard() : mainMenuKeyboard(env),
  };
}

function helpReply(env: RuntimeEnv): TelegramReply {
  return {
    text: [
      "<b>Справка</b>",
      "Рецепты - каталог с пагинацией.",
      "Категории - быстрый фильтр.",
      "Избранное и оценки сохраняются отдельно для вашего Telegram-профиля.",
      "",
      "Для поиска нажмите «Поиск» и отправьте название блюда, категорию или ингредиент.",
    ].join("\n"),
    replyMarkup: replyMenuKeyboard(),
  };
}

function searchHelpReply(
  env: RuntimeEnv,
  lead = "Напишите название блюда или ингредиент обычным сообщением.",
): TelegramReply {
  return {
    text: [
      "<b>Поиск рецептов</b>",
      escapeHtml(lead),
      "",
      "Примеры: <code>паста</code>, <code>гречка</code>, <code>сырники</code>.",
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [{ text: MENU_RECIPES, callback_data: "recipes" }],
        bottomMenuRow(env),
      ],
    },
  };
}

function dashboardReply(env: RuntimeEnv): TelegramReply {
  return {
    text: "<b>Dashboard</b>\nОнлайн-панель с каталогом, пользователями, оценками и статистикой.",
    replyMarkup: {
      inline_keyboard: [
        [{ text: MENU_DASHBOARD, url: dashboardUrl(env) }],
        [{ text: MENU_HOME, callback_data: "menu" }],
      ],
    },
  };
}

async function recipesReply(
  db: D1Database,
  options: { title: string; query: string; categoryId: number | null; offset: number },
): Promise<TelegramReply> {
  const recipes = await searchRecipes(db, {
    query: options.query,
    categoryId: options.categoryId,
    limit: PAGE_SIZE + 1,
    offset: options.offset,
  });
  const visibleRecipes = recipes.slice(0, PAGE_SIZE);
  const hasNext = recipes.length > PAGE_SIZE;
  if (recipes.length === 0) {
    return {
      text: `<b>${escapeHtml(options.title)}</b>\nНичего не найдено. Попробуйте другой запрос или откройте категории.`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: MENU_RECIPES, callback_data: "recipes" }],
          [{ text: MENU_CATEGORIES, callback_data: "categories" }],
          [{ text: MENU_HOME, callback_data: "menu" }],
        ],
      },
    };
  }
  return {
    text: [
      `<b>${escapeHtml(options.title)}</b>`,
      `Страница ${Math.floor(options.offset / PAGE_SIZE) + 1} · ${visibleRecipes.length} карточек`,
      "",
      visibleRecipes.map(recipeSummaryLine).join("\n"),
    ].join("\n"),
    replyMarkup: recipeListKeyboard(visibleRecipes, {
      offset: options.offset,
      hasNext,
      categoryId: options.categoryId,
    }),
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
  rows.push([{ text: MENU_RECIPES, callback_data: "recipes" }]);
  rows.push([{ text: MENU_HOME, callback_data: "menu" }]);
  return {
    text: "<b>Категории</b>\nВыберите раздел каталога.",
    replyMarkup: { inline_keyboard: rows },
  };
}

async function favoritesReply(
  db: D1Database,
  user: TelegramUser,
  offset: number,
): Promise<TelegramReply> {
  const favorites = await listFavorites(db, user.id);
  if (favorites.length === 0) {
    return {
      text: "<b>Избранное</b>\nПока пусто. Откройте рецепт и добавьте его звездой.",
      replyMarkup: {
        inline_keyboard: [
          [{ text: MENU_RECIPES, callback_data: "recipes" }],
          [{ text: MENU_HOME, callback_data: "menu" }],
        ],
      },
    };
  }
  const visibleFavorites = favorites.slice(offset, offset + PAGE_SIZE);
  const hasNext = offset + PAGE_SIZE < favorites.length;
  return {
    text: [
      "<b>Избранное</b>",
      `Страница ${Math.floor(offset / PAGE_SIZE) + 1} · ${visibleFavorites.length} карточек`,
      "",
      visibleFavorites.map(recipeSummaryLine).join("\n"),
    ].join("\n"),
    replyMarkup: favoriteListKeyboard(visibleFavorites, { offset, hasNext }),
  };
}

async function recipeCardReply(
  db: D1Database,
  recipeId: number,
  env: RuntimeEnv,
  user?: TelegramUser,
  notice?: string,
): Promise<TelegramReply> {
  const recipe = await getRecipe(db, recipeId);
  if (recipe === null) {
    return recipeNotFoundReply();
  }
  const userState =
    user === undefined ? undefined : await getUserRecipeState(db, user.id, recipe.id);
  return {
    text: recipeCardText(recipe, userState, notice),
    replyMarkup: recipeActionKeyboard(recipe.id, userState, env),
  };
}

async function ratingReply(db: D1Database, recipeId: number): Promise<TelegramReply> {
  const recipe = await getRecipe(db, recipeId);
  if (recipe === null) {
    return recipeNotFoundReply();
  }
  return {
    text: `<b>${escapeHtml(recipe.title)}</b>\nВыберите оценку от 1 до 5:`,
    replyMarkup: ratingKeyboard(recipe.id),
  };
}

function unknownUserReply(): TelegramReply {
  return {
    text: "<b>Не удалось определить Telegram-пользователя.</b>\nНажмите /start и повторите действие.",
    replyMarkup: { inline_keyboard: [[{ text: MENU_HOME, callback_data: "menu" }]] },
  };
}

function invalidCommandReply(env: RuntimeEnv, hint: string): TelegramReply {
  return {
    text: [
      "<b>Неверный формат команды</b>",
      hint,
      "",
      "Можно продолжить через кнопки меню.",
    ].join("\n"),
    replyMarkup: mainMenuKeyboard(env),
  };
}

function recipeNotFoundReply(): TelegramReply {
  return {
    text: "<b>Рецепт не найден</b>\nВозможно, карточка была удалена или ссылка устарела.",
    replyMarkup: {
      inline_keyboard: [
        [{ text: MENU_RECIPES, callback_data: "recipes" }],
        [{ text: MENU_HOME, callback_data: "menu" }],
      ],
    },
  };
}

function mainMenuKeyboard(env: RuntimeEnv): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: MENU_RECIPES, callback_data: "recipes" },
        { text: MENU_CATEGORIES, callback_data: "categories" },
      ],
      [
        { text: MENU_FAVORITES, callback_data: "favorites" },
        { text: MENU_SEARCH, callback_data: "search_help" },
      ],
      [
        { text: MENU_DASHBOARD, url: dashboardUrl(env) },
        { text: MENU_HELP, callback_data: "help" },
      ],
    ],
  };
}

function replyMenuKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: MENU_RECIPES }, { text: MENU_CATEGORIES }],
      [{ text: MENU_FAVORITES }, { text: MENU_SEARCH }],
      [{ text: MENU_HOME }, { text: MENU_HELP }, { text: MENU_DASHBOARD }],
    ],
    resize_keyboard: true,
    is_persistent: true,
    one_time_keyboard: false,
    selective: false,
    input_field_placeholder: "Выберите действие или напишите запрос",
  };
}

function recipeListKeyboard(
  recipes: RecipeSummary[],
  navigation: { offset: number; hasNext: boolean; categoryId: number | null },
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = recipes.map((recipe) => [
    { text: recipeButtonTitle(recipe), callback_data: `recipe:${recipe.id}` },
  ]);
  const pageRow = pageNavigationRow(navigation, navigation.categoryId);
  if (pageRow.length > 0) {
    rows.push(pageRow);
  }
  rows.push([
    { text: MENU_CATEGORIES, callback_data: "categories" },
    { text: MENU_HOME, callback_data: "menu" },
  ]);
  return { inline_keyboard: rows };
}

function favoriteListKeyboard(
  recipes: RecipeSummary[],
  navigation: { offset: number; hasNext: boolean },
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  for (const recipe of recipes) {
    rows.push([{ text: recipeButtonTitle(recipe), callback_data: `recipe:${recipe.id}` }]);
    rows.push([{ text: "Убрать из избранного", callback_data: `unfavorite:${recipe.id}` }]);
  }
  const pageRow = pageNavigationRow(navigation, null, "favorites");
  if (pageRow.length > 0) {
    rows.push(pageRow);
  }
  rows.push([
    { text: MENU_RECIPES, callback_data: "recipes" },
    { text: MENU_HOME, callback_data: "menu" },
  ]);
  return { inline_keyboard: rows };
}

function pageNavigationRow(
  navigation: { offset: number; hasNext: boolean },
  categoryId: number | null,
  mode: "recipes" | "favorites" = "recipes",
): InlineKeyboardButton[] {
  const row: InlineKeyboardButton[] = [];
  if (navigation.offset > 0) {
    row.push({
      text: "‹ Назад",
      callback_data: pageCallbackData(
        Math.max(navigation.offset - PAGE_SIZE, 0),
        categoryId,
        mode,
      ),
    });
  }
  if (navigation.hasNext) {
    row.push({
      text: "Дальше ›",
      callback_data: pageCallbackData(navigation.offset + PAGE_SIZE, categoryId, mode),
    });
  }
  return row;
}

function pageCallbackData(
  offset: number,
  categoryId: number | null,
  mode: "recipes" | "favorites",
): string {
  if (mode === "favorites") {
    return `favorites:${offset}`;
  }
  return categoryId === null ? `recipes:${offset}` : `category:${categoryId}:${offset}`;
}

function recipeActionKeyboard(
  recipeId: number,
  state: UserRecipeState | undefined,
  env: RuntimeEnv,
): InlineKeyboardMarkup {
  const favoriteButton =
    state?.isFavorite === true
      ? { text: "Убрать из избранного", callback_data: `remove_favorite:${recipeId}` }
      : { text: "В избранное", callback_data: `favorite:${recipeId}` };
  return {
    inline_keyboard: [
      [
        favoriteButton,
        { text: "Оценить", callback_data: `rate_menu:${recipeId}` },
      ],
      [
        { text: MENU_RECIPES, callback_data: "recipes" },
        { text: MENU_FAVORITES, callback_data: "favorites" },
      ],
      [
        { text: MENU_HOME, callback_data: "menu" },
        { text: MENU_DASHBOARD, url: dashboardUrl(env) },
      ],
    ],
  };
}

function ratingKeyboard(recipeId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [1, 2, 3, 4, 5].map((stars) => ({
        text: `${stars}★`,
        callback_data: `rate:${recipeId}:${stars}`,
      })),
      [{ text: "Назад к рецепту", callback_data: `recipe:${recipeId}` }],
    ],
  };
}

function bottomMenuRow(env: RuntimeEnv): InlineKeyboardButton[] {
  return [
    { text: MENU_HOME, callback_data: "menu" },
    { text: MENU_DASHBOARD, url: dashboardUrl(env) },
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
  const rating = recipe.averageRating === null ? "нет оценок" : `${recipe.averageRating}/5`;
  return [
    `<b>${escapeHtml(recipe.title)}</b>`,
    `${escapeHtml(recipe.category)} · ${recipe.cookingMinutes} мин · ${escapeHtml(recipe.difficulty)}`,
    `${rating} · оценок: ${recipe.ratingCount} · избранное: ${recipe.favoriteCount}`,
  ].join("\n");
}

function recipeButtonTitle(recipe: RecipeSummary): string {
  const rating = recipe.averageRating === null ? "" : ` · ${recipe.averageRating}/5`;
  return `${trimText(recipe.title, 34)} · ${recipe.cookingMinutes} мин${rating}`;
}

function recipeCardText(
  recipe: RecipeDetails,
  state: UserRecipeState | undefined,
  notice?: string,
): string {
  const ingredients = recipe.ingredients
    .map((item) => {
      const note = item.note === null ? "" : ` (${escapeHtml(item.note)})`;
      return `• ${escapeHtml(item.name)}: ${formatQuantity(item.quantity)} ${escapeHtml(item.unit)}${note}`;
    })
    .join("\n");
  const rating =
    recipe.averageRating === null
      ? "нет оценок"
      : `${recipe.averageRating}/5 (${recipe.ratingCount} оцен.)`;
  const personal =
    state === undefined
      ? ""
      : [
          state.isFavorite ? "в избранном" : "не в избранном",
          state.userRating === null ? "моя оценка: нет" : `моя оценка: ${state.userRating}/5`,
        ].join(" · ");
  const prefix = notice === undefined ? "" : `<b>${escapeHtml(notice)}</b>\n\n`;
  return [
    `${prefix}<b>${escapeHtml(recipe.title)}</b>`,
    `${escapeHtml(recipe.category)} · ${recipe.cookingMinutes} мин · ${escapeHtml(recipe.difficulty)}`,
    `Рейтинг: ${rating} · избранное: ${recipe.favoriteCount}`,
    personal,
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
): Promise<boolean> {
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
    await logTelegramFailureResponse("telegram_send_failed", response);
    return false;
  }
  return true;
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
  if (isReplyKeyboardMarkup(result.reply.replyMarkup)) {
    await sendTelegramMessage(token, chatId, result.reply);
    return;
  }
  const edited = await editTelegramMessage(token, chatId, messageId, result.reply);
  if (!edited) {
    await sendTelegramMessage(token, chatId, result.reply);
  }
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
    await logTelegramFailureResponse("telegram_callback_answer_failed", response);
  }
}

async function editTelegramMessage(
  token: string,
  chatId: number,
  messageId: number,
  reply: TelegramReply,
): Promise<boolean> {
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
    const body = await response.text();
    await logTelegramFailure("telegram_edit_failed", response.status, body);
    return body.includes("message is not modified");
  }
  return true;
}

async function logTelegramFailureResponse(event: string, response: Response): Promise<void> {
  await logTelegramFailure(event, response.status, await response.text());
}

async function logTelegramFailure(event: string, status: number, body: string): Promise<void> {
  console.log(
    JSON.stringify({
      event,
      status,
      body,
    }),
  );
}

function parseTelegramUpdate(value: unknown): TelegramUpdate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Telegram update object expected");
  }
  return value;
}

function isReplyKeyboardMarkup(
  replyMarkup: TelegramReplyMarkup | undefined,
): replyMarkup is ReplyKeyboardMarkup {
  return replyMarkup !== undefined && "keyboard" in replyMarkup;
}

function parseCallbackInt(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer`);
  }
  return parsed;
}

function tryParsePositiveInt(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOffset(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
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

function tryParseStars(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

function readCommandName(text: string): string {
  if (!text.startsWith("/")) {
    return "";
  }
  const [command = ""] = text.trim().split(/\s+/, 1);
  return command.split("@", 1)[0]?.toLowerCase() ?? "";
}

function readCommandArgs(text: string): string {
  if (!text.startsWith("/")) {
    return "";
  }
  const trimmed = text.trim();
  const firstSpace = trimmed.search(/\s/);
  return firstSpace === -1 ? "" : trimmed.slice(firstSpace).trim();
}

function normalizeMenuText(text: string): string {
  return text.replace(/^[^\p{L}\p{N}/]+/u, "").trim().toLowerCase();
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
