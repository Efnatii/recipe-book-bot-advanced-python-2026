const API_BASE = "https://recipe-book-online-api-2026.egory780.workers.dev";
const DEMO_TELEGRAM_ID = 1001;

const state = {
  recipes: [],
  currentRecipe: null,
};

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  statRecipes: document.querySelector("#statRecipes"),
  statCategories: document.querySelector("#statCategories"),
  statIngredients: document.querySelector("#statIngredients"),
  statCrud: document.querySelector("#statCrud"),
  recipeList: document.querySelector("#recipeList"),
  recipeDetail: document.querySelector("#recipeDetail"),
  recipeForm: document.querySelector("#recipeForm"),
  searchInput: document.querySelector("#searchInput"),
  refreshButton: document.querySelector("#refreshButton"),
  newButton: document.querySelector("#newButton"),
  deleteButton: document.querySelector("#deleteButton"),
  favoriteButton: document.querySelector("#favoriteButton"),
  rateButton: document.querySelector("#rateButton"),
  recipeId: document.querySelector("#recipeId"),
  titleInput: document.querySelector("#titleInput"),
  categoryInput: document.querySelector("#categoryInput"),
  minutesInput: document.querySelector("#minutesInput"),
  difficultyInput: document.querySelector("#difficultyInput"),
  descriptionInput: document.querySelector("#descriptionInput"),
  instructionsInput: document.querySelector("#instructionsInput"),
  ingredientsInput: document.querySelector("#ingredientsInput"),
};

boot();

function boot() {
  elements.refreshButton.addEventListener("click", () => loadAll());
  elements.newButton.addEventListener("click", () => startNewRecipe());
  elements.searchInput.addEventListener("input", debounce(() => loadRecipes(), 280));
  elements.recipeForm.addEventListener("submit", (event) => saveRecipe(event));
  elements.deleteButton.addEventListener("click", () => deleteCurrentRecipe());
  elements.favoriteButton.addEventListener("click", () => addCurrentFavorite());
  elements.rateButton.addEventListener("click", () => rateCurrentRecipe());
  loadAll();
}

async function loadAll() {
  setStatus("Подключение...", "");
  await ensureDemoUser();
  await Promise.all([loadStats(), loadRecipes()]);
  setStatus("Online D1", "online");
}

async function loadStats() {
  const stats = await api("/api/stats");
  elements.statRecipes.textContent = stats.recipes;
  elements.statCategories.textContent = stats.categories;
  elements.statIngredients.textContent = stats.ingredients;
  elements.statCrud.textContent = stats.crudOperations;
}

async function loadRecipes() {
  const query = elements.searchInput.value.trim();
  const data = await api(`/api/recipes?query=${encodeURIComponent(query)}&limit=30`);
  state.recipes = data;
  renderList();
  if (state.currentRecipe === null && data.length > 0) {
    await selectRecipe(data[0].id);
  }
  if (data.length === 0) {
    elements.recipeDetail.innerHTML = '<p class="empty">Рецепты не найдены.</p>';
  }
}

function renderList() {
  if (state.recipes.length === 0) {
    elements.recipeList.innerHTML = '<p class="empty">Нет рецептов.</p>';
    return;
  }
  elements.recipeList.replaceChildren(
    ...state.recipes.map((recipe) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `recipe-item${state.currentRecipe?.id === recipe.id ? " active" : ""}`;
      button.innerHTML = `
        <strong>${escapeHtml(recipe.title)}</strong>
        <span>${escapeHtml(recipe.category)} · ${recipe.cookingMinutes} мин. · рейтинг ${recipe.averageRating ?? "нет"}</span>
      `;
      button.addEventListener("click", () => selectRecipe(recipe.id));
      return button;
    }),
  );
}

async function selectRecipe(recipeId) {
  const recipe = await api(`/api/recipes/${recipeId}`);
  state.currentRecipe = recipe;
  renderList();
  renderDetail(recipe);
  fillForm(recipe);
}

function renderDetail(recipe) {
  const ingredients = recipe.ingredients
    .map((item) => `<li>${escapeHtml(item.name)}: ${item.quantity} ${escapeHtml(item.unit)}${item.note ? `, ${escapeHtml(item.note)}` : ""}</li>`)
    .join("");
  elements.recipeDetail.innerHTML = `
    <h2>${escapeHtml(recipe.title)}</h2>
    <p>${escapeHtml(recipe.description)}</p>
    <div class="meta">
      <span>${escapeHtml(recipe.category)}</span>
      <span>${recipe.cookingMinutes} мин.</span>
      <span>${escapeHtml(recipe.difficulty)}</span>
      <span>избранное: ${recipe.favoriteCount}</span>
      <span>рейтинг: ${recipe.averageRating ?? "нет"}</span>
    </div>
    <ul class="ingredients">${ingredients}</ul>
    <p>${escapeHtml(recipe.instructions)}</p>
  `;
}

function fillForm(recipe) {
  elements.recipeId.value = recipe.id;
  elements.titleInput.value = recipe.title;
  elements.categoryInput.value = recipe.category;
  elements.minutesInput.value = recipe.cookingMinutes;
  elements.difficultyInput.value = recipe.difficulty;
  elements.descriptionInput.value = recipe.description;
  elements.instructionsInput.value = recipe.instructions;
  elements.ingredientsInput.value = recipe.ingredients
    .map((item) => [item.name, item.quantity, item.unit, item.note ?? ""].join(" | "))
    .join("\n");
}

function startNewRecipe() {
  state.currentRecipe = null;
  elements.recipeId.value = "";
  elements.titleInput.value = "";
  elements.categoryInput.value = "завтраки";
  elements.minutesInput.value = "20";
  elements.difficultyInput.value = "простая";
  elements.descriptionInput.value = "";
  elements.instructionsInput.value = "";
  elements.ingredientsInput.value = "ингредиент | 1 | шт |";
  elements.recipeDetail.innerHTML = '<p class="empty">Заполните форму и сохраните новый рецепт.</p>';
  renderList();
}

async function saveRecipe(event) {
  event.preventDefault();
  const recipe = readForm();
  const recipeId = elements.recipeId.value;
  const path = recipeId ? `/api/recipes/${recipeId}` : `/api/recipes?authorTelegramId=${DEMO_TELEGRAM_ID}`;
  const method = recipeId ? "PUT" : "POST";
  const saved = await api(path, { method, body: recipe });
  state.currentRecipe = saved;
  await Promise.all([loadStats(), loadRecipes()]);
  await selectRecipe(saved.id);
}

async function deleteCurrentRecipe() {
  const recipeId = elements.recipeId.value;
  if (!recipeId) {
    return;
  }
  await api(`/api/recipes/${recipeId}`, { method: "DELETE" });
  state.currentRecipe = null;
  await Promise.all([loadStats(), loadRecipes()]);
  startNewRecipe();
}

async function addCurrentFavorite() {
  const recipeId = elements.recipeId.value;
  if (!recipeId) {
    return;
  }
  await api(`/api/users/${DEMO_TELEGRAM_ID}/favorites/${recipeId}`, { method: "POST" });
  await selectRecipe(Number(recipeId));
  await loadStats();
}

async function rateCurrentRecipe() {
  const recipeId = elements.recipeId.value;
  if (!recipeId) {
    return;
  }
  await api(`/api/users/${DEMO_TELEGRAM_ID}/ratings/${recipeId}`, {
    method: "POST",
    body: { stars: 5, comment: "Оценка из онлайн-дашборда" },
  });
  await selectRecipe(Number(recipeId));
  await loadStats();
}

function readForm() {
  return {
    title: elements.titleInput.value,
    category: elements.categoryInput.value,
    cookingMinutes: Number(elements.minutesInput.value),
    difficulty: elements.difficultyInput.value,
    description: elements.descriptionInput.value,
    instructions: elements.instructionsInput.value,
    ingredients: parseIngredients(elements.ingredientsInput.value),
  };
}

function parseIngredients(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", quantity = "1", unit = "g", note = ""] = line.split("|").map((part) => part.trim());
      return { name, quantity: Number(quantity), unit, note: note || null };
    });
}

async function ensureDemoUser() {
  await api("/api/users", {
    method: "POST",
    body: { telegramId: DEMO_TELEGRAM_ID, fullName: "Demo User", username: "demo_recipe_user" },
  });
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    setStatus("Ошибка API", "error");
    throw new Error(payload.error ?? "API request failed");
  }
  return payload.data ?? payload;
}

function setStatus(text, className) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.className = `status ${className}`;
}

function debounce(fn, delay) {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = window.setTimeout(fn, delay);
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
