import type { RuntimeEnv } from "./env";
import {
  corsPreflight,
  error,
  HttpError,
  json,
  parseNonNegativeInt,
  parsePositiveInt,
  readJson,
} from "./http";
import {
  addFavorite,
  createRecipe,
  deleteRecipe,
  ensureUser,
  getRecipe,
  listCategories,
  listFavorites,
  listIngredients,
  onlineCrudOperationNames,
  rateRecipe,
  recipeStatistics,
  removeFavorite,
  searchRecipes,
  updateRecipe,
} from "./repository";
import { handleTelegramWebhook } from "./telegram";
import { parseRatingInput, parseRecipeInput, parseUserInput } from "./validation";

export default {
  async fetch(request: Request, env: RuntimeEnv, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return corsPreflight();
    }

    try {
      return await route(request, env, ctx);
    } catch (caught) {
      if (caught instanceof HttpError) {
        return error(caught.status, caught.message, caught.details);
      }
      console.log(
        JSON.stringify({
          event: "unhandled_error",
          message: caught instanceof Error ? caught.message : "Unknown error",
        }),
      );
      return error(500, "Internal server error");
    }
  },
} satisfies ExportedHandler<RuntimeEnv>;

async function route(request: Request, env: RuntimeEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/" && request.method === "GET") {
    return json({
      ok: true,
      name: "Recipe Book Online API",
      site: env.PUBLIC_SITE_URL,
      endpoints: ["/api/health", "/api/stats", "/api/recipes", "/api/categories"],
    });
  }

  if (url.pathname === "/telegram/webhook" && request.method === "POST") {
    return handleTelegramWebhook(request, env, ctx);
  }

  if (parts[0] !== "api") {
    throw new HttpError(404, "Route not found");
  }

  if (parts.length === 2 && parts[1] === "health" && request.method === "GET") {
    return json({
      ok: true,
      storage: "Cloudflare D1",
      crudOperations: onlineCrudOperationNames,
    });
  }

  if (parts.length === 2 && parts[1] === "stats" && request.method === "GET") {
    return json({ ok: true, data: await recipeStatistics(env.DB) });
  }

  if (parts.length === 2 && parts[1] === "categories" && request.method === "GET") {
    return json({ ok: true, data: await listCategories(env.DB) });
  }

  if (parts.length === 2 && parts[1] === "ingredients" && request.method === "GET") {
    return json({ ok: true, data: await listIngredients(env.DB) });
  }

  if (parts.length === 2 && parts[1] === "users" && request.method === "POST") {
    const user = await ensureUser(env.DB, parseUserInput(await readJson(request)));
    return json({ ok: true, data: user }, 201);
  }

  if (parts.length === 2 && parts[1] === "recipes") {
    if (request.method === "GET") {
      const categoryIdRaw = url.searchParams.get("categoryId");
      const limitRaw = url.searchParams.get("limit");
      const offsetRaw = url.searchParams.get("offset");
      const recipes = await searchRecipes(env.DB, {
        query: url.searchParams.get("query") ?? "",
        categoryId: categoryIdRaw === null ? null : parsePositiveInt(categoryIdRaw, "categoryId"),
        limit: limitRaw === null ? 20 : parsePositiveInt(limitRaw, "limit"),
        offset: offsetRaw === null ? 0 : parseNonNegativeInt(offsetRaw, "offset"),
      });
      return json({ ok: true, data: recipes });
    }
    if (request.method === "POST") {
      const authorRaw = url.searchParams.get("authorTelegramId");
      const recipe = await createRecipe(
        env.DB,
        parseRecipeInput(await readJson(request)),
        authorRaw === null ? null : parsePositiveInt(authorRaw, "authorTelegramId"),
      );
      return json({ ok: true, data: recipe }, 201);
    }
  }

  if (parts.length === 3 && parts[1] === "recipes") {
    const recipeId = parsePositiveInt(parts[2], "recipeId");
    if (request.method === "GET") {
      const recipe = await getRecipe(env.DB, recipeId);
      if (recipe === null) {
        throw new HttpError(404, "Recipe not found");
      }
      return json({ ok: true, data: recipe });
    }
    if (request.method === "PUT") {
      const recipe = await updateRecipe(env.DB, recipeId, parseRecipeInput(await readJson(request)));
      if (recipe === null) {
        throw new HttpError(404, "Recipe not found");
      }
      return json({ ok: true, data: recipe });
    }
    if (request.method === "DELETE") {
      return json({ ok: true, deleted: await deleteRecipe(env.DB, recipeId) });
    }
  }

  if (
    parts.length === 4 &&
    parts[1] === "users" &&
    parts[3] === "favorites" &&
    request.method === "GET"
  ) {
    const telegramId = parsePositiveInt(parts[2], "telegramId");
    return json({ ok: true, data: await listFavorites(env.DB, telegramId) });
  }

  if (
    parts.length === 5 &&
    parts[1] === "users" &&
    parts[3] === "favorites" &&
    (request.method === "POST" || request.method === "DELETE")
  ) {
    const telegramId = parsePositiveInt(parts[2], "telegramId");
    const recipeId = parsePositiveInt(parts[4], "recipeId");
    if (request.method === "POST") {
      await addFavorite(env.DB, telegramId, recipeId);
      return json({ ok: true });
    }
    return json({ ok: true, deleted: await removeFavorite(env.DB, telegramId, recipeId) });
  }

  if (
    parts.length === 5 &&
    parts[1] === "users" &&
    parts[3] === "ratings" &&
    request.method === "POST"
  ) {
    const telegramId = parsePositiveInt(parts[2], "telegramId");
    const recipeId = parsePositiveInt(parts[4], "recipeId");
    const rating = await rateRecipe(env.DB, telegramId, recipeId, parseRatingInput(await readJson(request)));
    return json({ ok: true, data: rating });
  }

  throw new HttpError(404, "Route not found");
}
