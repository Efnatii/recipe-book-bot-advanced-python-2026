export type IngredientInput = {
  name: string;
  quantity: number;
  unit: string;
  note: string | null;
};

export type RecipeInput = {
  title: string;
  description: string;
  instructions: string;
  category: string;
  cookingMinutes: number;
  difficulty: string;
  ingredients: IngredientInput[];
};

export type UserInput = {
  telegramId: number;
  fullName: string;
  username: string | null;
};

export type RatingInput = {
  stars: number;
  comment: string | null;
};

export type RecipeIngredientView = IngredientInput & {
  id: number;
};

export type RecipeSummary = {
  id: number;
  title: string;
  description: string;
  cookingMinutes: number;
  difficulty: string;
  category: string;
  authorName: string | null;
  favoriteCount: number;
  ratingCount: number;
  averageRating: number | null;
  createdAt: string;
  updatedAt: string;
};

export type RecipeDetails = RecipeSummary & {
  instructions: string;
  ingredients: RecipeIngredientView[];
};

export type UserView = {
  id: number;
  telegramId: number;
  fullName: string;
  username: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UserRatingView = RecipeDetails & {
  userRating: {
    stars: number;
    comment: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

type IdRow = {
  id: number;
};

type CountRow = {
  count: number;
};

type RecipeRow = {
  id: number;
  title: string;
  description: string;
  instructions: string;
  cooking_minutes: number;
  difficulty: string;
  category_name: string;
  author_name: string | null;
  favorite_count: number;
  rating_count: number;
  average_rating: number | null;
  created_at: string;
  updated_at: string;
};

type IngredientRow = {
  id: number;
  name: string;
  unit: string;
  quantity: number;
  note: string | null;
};

type UserRow = {
  id: number;
  telegram_id: number;
  full_name: string;
  username: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type UserRatingRow = {
  recipe_id: number;
  stars: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

type D1RunMeta = {
  last_row_id?: number | string;
};

const recipeSelect = `
  SELECT
    r.id,
    r.title,
    r.description,
    r.instructions,
    r.cooking_minutes,
    r.difficulty,
    c.name AS category_name,
    u.full_name AS author_name,
    (SELECT COUNT(*) FROM favorites f WHERE f.recipe_id = r.id) AS favorite_count,
    (SELECT COUNT(*) FROM ratings rt WHERE rt.recipe_id = r.id) AS rating_count,
    (SELECT ROUND(AVG(rt.stars), 2) FROM ratings rt WHERE rt.recipe_id = r.id) AS average_rating,
    r.created_at,
    r.updated_at
  FROM recipes r
  JOIN categories c ON c.id = r.category_id
  LEFT JOIN users u ON u.id = r.author_user_id
`;

export const onlineCrudOperationNames = [
  "health",
  "recipe_statistics",
  "list_categories",
  "list_ingredients",
  "search_recipes",
  "get_recipe",
  "create_recipe",
  "update_recipe",
  "delete_recipe",
  "list_users",
  "ensure_user",
  "list_favorites",
  "add_favorite",
  "remove_favorite",
  "list_user_ratings",
  "rate_recipe",
  "average_rating",
  "telegram_webhook",
];

export async function recipeStatistics(db: D1Database): Promise<Record<string, number>> {
  const [recipes, categories, ingredients, recipeIngredients, users, favorites, ratings] =
    await Promise.all([
      countTable(db, "recipes"),
      countTable(db, "categories"),
      countTable(db, "ingredients"),
      countTable(db, "recipe_ingredients"),
      countTable(db, "users"),
      countTable(db, "favorites"),
      countTable(db, "ratings"),
    ]);
  return {
    users,
    categories,
    ingredients,
    recipeIngredients,
    recipes,
    favorites,
    ratings,
    crudOperations: onlineCrudOperationNames.length,
  };
}

export async function listCategories(db: D1Database): Promise<{ id: number; name: string }[]> {
  const result = await db
    .prepare("SELECT id, name FROM categories ORDER BY name")
    .all<{ id: number; name: string }>();
  return result.results;
}

export async function listIngredients(
  db: D1Database,
): Promise<{ id: number; name: string; unit: string }[]> {
  const result = await db
    .prepare("SELECT id, name, unit FROM ingredients ORDER BY name")
    .all<{ id: number; name: string; unit: string }>();
  return result.results;
}

export async function searchRecipes(
  db: D1Database,
  options: { query: string; categoryId: number | null; limit: number; offset?: number },
): Promise<RecipeSummary[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const query = options.query.trim();
  if (query.length > 0) {
    where.push("(r.title LIKE ? OR r.description LIKE ?)");
    const pattern = `%${query}%`;
    params.push(pattern, pattern);
  }
  if (options.categoryId !== null) {
    where.push("r.category_id = ?");
    params.push(options.categoryId);
  }
  params.push(Math.min(Math.max(options.limit, 1), 50));
  params.push(Math.max(options.offset ?? 0, 0));
  const statement = `
    ${recipeSelect}
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r.title
    LIMIT ? OFFSET ?
  `;
  const result = await db.prepare(statement).bind(...params).all<RecipeRow>();
  return result.results.map(rowToSummary);
}

export async function getRecipe(db: D1Database, recipeId: number): Promise<RecipeDetails | null> {
  const row = await db
    .prepare(`${recipeSelect} WHERE r.id = ?`)
    .bind(recipeId)
    .first<RecipeRow>();
  if (row === null) {
    return null;
  }
  return {
    ...rowToSummary(row),
    instructions: row.instructions,
    ingredients: await listRecipeIngredients(db, recipeId),
  };
}

export async function createRecipe(
  db: D1Database,
  input: RecipeInput,
  authorTelegramId: number | null = null,
): Promise<RecipeDetails> {
  const categoryId = await ensureCategory(db, input.category);
  const authorUserId =
    authorTelegramId === null ? null : await findUserIdByTelegramId(db, authorTelegramId);
  const result = await db
    .prepare(
      `INSERT INTO recipes (
        title,
        description,
        instructions,
        cooking_minutes,
        difficulty,
        author_user_id,
        category_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.title,
      input.description,
      input.instructions,
      input.cookingMinutes,
      input.difficulty,
      authorUserId,
      categoryId,
    )
    .run();
  const recipeId = readLastRowId(result);
  await replaceRecipeIngredients(db, recipeId, input.ingredients);
  return requireRecipe(db, recipeId);
}

export async function updateRecipe(
  db: D1Database,
  recipeId: number,
  input: RecipeInput,
): Promise<RecipeDetails | null> {
  const existing = await getRecipe(db, recipeId);
  if (existing === null) {
    return null;
  }
  const categoryId = await ensureCategory(db, input.category);
  await db
    .prepare(
      `UPDATE recipes
       SET title = ?,
           description = ?,
           instructions = ?,
           cooking_minutes = ?,
           difficulty = ?,
           category_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      input.title,
      input.description,
      input.instructions,
      input.cookingMinutes,
      input.difficulty,
      categoryId,
      recipeId,
    )
    .run();
  await replaceRecipeIngredients(db, recipeId, input.ingredients);
  return requireRecipe(db, recipeId);
}

export async function deleteRecipe(db: D1Database, recipeId: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM recipes WHERE id = ?").bind(recipeId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function ensureUser(db: D1Database, input: UserInput): Promise<{ id: number }> {
  await db
    .prepare(
      `INSERT INTO users (telegram_id, full_name, username)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         full_name = excluded.full_name,
         username = excluded.username,
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.telegramId, input.fullName, input.username)
    .run();
  return { id: await requireUserIdByTelegramId(db, input.telegramId) };
}

export async function listUsers(db: D1Database): Promise<UserView[]> {
  const result = await db
    .prepare(
      `SELECT id, telegram_id, full_name, username, is_active, created_at, updated_at
       FROM users
       ORDER BY updated_at DESC, id DESC`,
    )
    .all<UserRow>();
  return result.results.map(rowToUser);
}

export async function listFavorites(
  db: D1Database,
  telegramId: number,
): Promise<RecipeDetails[]> {
  const userId = await requireUserIdByTelegramId(db, telegramId);
  const result = await db
    .prepare("SELECT recipe_id AS id FROM favorites WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<IdRow>();
  const recipes: RecipeDetails[] = [];
  for (const row of result.results) {
    const recipe = await getRecipe(db, row.id);
    if (recipe !== null) {
      recipes.push(recipe);
    }
  }
  return recipes;
}

export async function listUserRatings(
  db: D1Database,
  telegramId: number,
): Promise<UserRatingView[]> {
  const userId = await requireUserIdByTelegramId(db, telegramId);
  const result = await db
    .prepare(
      `SELECT recipe_id, stars, comment, created_at, updated_at
       FROM ratings
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<UserRatingRow>();
  const recipes: UserRatingView[] = [];
  for (const row of result.results) {
    const recipe = await getRecipe(db, row.recipe_id);
    if (recipe !== null) {
      recipes.push({
        ...recipe,
        userRating: {
          stars: row.stars,
          comment: row.comment,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    }
  }
  return recipes;
}

export async function addFavorite(
  db: D1Database,
  telegramId: number,
  recipeId: number,
): Promise<void> {
  const userId = await requireUserIdByTelegramId(db, telegramId);
  await requireRecipe(db, recipeId);
  await db
    .prepare("INSERT OR IGNORE INTO favorites (user_id, recipe_id) VALUES (?, ?)")
    .bind(userId, recipeId)
    .run();
}

export async function removeFavorite(
  db: D1Database,
  telegramId: number,
  recipeId: number,
): Promise<boolean> {
  const userId = await requireUserIdByTelegramId(db, telegramId);
  const result = await db
    .prepare("DELETE FROM favorites WHERE user_id = ? AND recipe_id = ?")
    .bind(userId, recipeId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function rateRecipe(
  db: D1Database,
  telegramId: number,
  recipeId: number,
  input: RatingInput,
): Promise<{ averageRating: number | null; ratingCount: number }> {
  const userId = await requireUserIdByTelegramId(db, telegramId);
  await requireRecipe(db, recipeId);
  await db
    .prepare(
      `INSERT INTO ratings (user_id, recipe_id, stars, comment)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, recipe_id) DO UPDATE SET
         stars = excluded.stars,
         comment = excluded.comment,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(userId, recipeId, input.stars, input.comment)
    .run();
  const row = await db
    .prepare(
      "SELECT ROUND(AVG(stars), 2) AS average_rating, COUNT(*) AS rating_count FROM ratings WHERE recipe_id = ?",
    )
    .bind(recipeId)
    .first<{ average_rating: number | null; rating_count: number }>();
  return {
    averageRating: row?.average_rating ?? null,
    ratingCount: row?.rating_count ?? 0,
  };
}

async function listRecipeIngredients(
  db: D1Database,
  recipeId: number,
): Promise<RecipeIngredientView[]> {
  const result = await db
    .prepare(
      `SELECT i.id, i.name, i.unit, ri.quantity, ri.note
       FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = ?
       ORDER BY i.name`,
    )
    .bind(recipeId)
    .all<IngredientRow>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit,
    quantity: row.quantity,
    note: row.note,
  }));
}

async function replaceRecipeIngredients(
  db: D1Database,
  recipeId: number,
  ingredients: IngredientInput[],
): Promise<void> {
  await db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(recipeId).run();
  for (const item of ingredients) {
    const ingredientId = await ensureIngredient(db, item.name, item.unit);
    await db
      .prepare(
        `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, note)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(recipeId, ingredientId, item.quantity, item.note)
      .run();
  }
}

async function ensureCategory(db: D1Database, name: string): Promise<number> {
  await db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").bind(name).run();
  return requireId(db, "SELECT id FROM categories WHERE name = ?", name);
}

async function ensureIngredient(db: D1Database, name: string, unit: string): Promise<number> {
  await db
    .prepare(
      `INSERT INTO ingredients (name, unit)
       VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET unit = excluded.unit`,
    )
    .bind(name, unit)
    .run();
  return requireId(db, "SELECT id FROM ingredients WHERE name = ?", name);
}

async function findUserIdByTelegramId(db: D1Database, telegramId: number): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .bind(telegramId)
    .first<IdRow>();
  return row?.id ?? null;
}

async function requireUserIdByTelegramId(db: D1Database, telegramId: number): Promise<number> {
  const userId = await findUserIdByTelegramId(db, telegramId);
  if (userId === null) {
    throw new Error(`Telegram user ${telegramId} not found`);
  }
  return userId;
}

async function requireId(db: D1Database, statement: string, value: string): Promise<number> {
  const row = await db.prepare(statement).bind(value).first<IdRow>();
  if (row === null) {
    throw new Error("Expected database row was not found");
  }
  return row.id;
}

async function requireRecipe(db: D1Database, recipeId: number): Promise<RecipeDetails> {
  const recipe = await getRecipe(db, recipeId);
  if (recipe === null) {
    throw new Error(`Recipe ${recipeId} not found`);
  }
  return recipe;
}

async function countTable(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<CountRow>();
  return row?.count ?? 0;
}

function rowToSummary(row: RecipeRow): RecipeSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    cookingMinutes: row.cooking_minutes,
    difficulty: row.difficulty,
    category: row.category_name,
    authorName: row.author_name,
    favoriteCount: row.favorite_count,
    ratingCount: row.rating_count,
    averageRating: row.average_rating,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToUser(row: UserRow): UserView {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    fullName: row.full_name,
    username: row.username,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readLastRowId(result: D1Result<unknown>): number {
  const meta = result.meta as D1RunMeta;
  const value = meta.last_row_id;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (parsed === undefined || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("D1 did not return last_row_id after insert");
  }
  return parsed;
}
