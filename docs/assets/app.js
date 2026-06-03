const API_BASE = "https://recipe-book-online-api-2026.egory780.workers.dev";
const DEMO_TELEGRAM_ID = 1001;

const state = {
  recipes: [],
  categories: [],
  currentRecipe: null,
  activeCategoryId: null,
};

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  statRecipes: document.querySelector("#statRecipes"),
  statCategories: document.querySelector("#statCategories"),
  statIngredients: document.querySelector("#statIngredients"),
  statCrud: document.querySelector("#statCrud"),
  categoryFilters: document.querySelector("#categoryFilters"),
  categoryOptions: document.querySelector("#categoryOptions"),
  resultCount: document.querySelector("#resultCount"),
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
  toast: document.querySelector("#toast"),
};

boot();

function boot() {
  elements.refreshButton.addEventListener("click", () => loadAll());
  elements.newButton.addEventListener("click", () => startNewRecipe());
  elements.searchInput.addEventListener("input", debounce(() => loadRecipes(), 260));
  elements.recipeForm.addEventListener("submit", (event) => saveRecipe(event));
  elements.deleteButton.addEventListener("click", () => deleteCurrentRecipe());
  elements.favoriteButton.addEventListener("click", () => addCurrentFavorite());
  elements.rateButton.addEventListener("click", () => rateCurrentRecipe());
  loadAll();
}

async function loadAll() {
  setStatus("Синхронизация", "");
  try {
    await ensureDemoUser();
    await Promise.all([loadStats(), loadCategories()]);
    await loadRecipes();
    setStatus("Online D1", "online");
  } catch (error) {
    setStatus("Ошибка API", "error");
    showToast(error instanceof Error ? error.message : "Не удалось загрузить данные");
  }
}

async function loadStats() {
  const stats = await api("/api/stats");
  elements.statRecipes.textContent = stats.recipes;
  elements.statCategories.textContent = stats.categories;
  elements.statIngredients.textContent = stats.ingredients;
  elements.statCrud.textContent = stats.crudOperations;
}

async function loadCategories() {
  state.categories = await api("/api/categories");
  renderCategoryFilters();
  renderCategoryOptions();
}

async function loadRecipes() {
  const query = elements.searchInput.value.trim();
  const params = new URLSearchParams({ query, limit: "50" });
  if (state.activeCategoryId !== null) {
    params.set("categoryId", String(state.activeCategoryId));
  }
  const data = await api(`/api/recipes?${params.toString()}`);
  state.recipes = data;
  renderList();

  const currentVisible = data.some((recipe) => recipe.id === state.currentRecipe?.id);
  if (!currentVisible && data.length > 0) {
    await selectRecipe(data[0].id);
    return;
  }
  if (data.length === 0) {
    state.currentRecipe = null;
    elements.recipeDetail.innerHTML = '<p class="detail-empty">Рецепты не найдены.</p>';
    clearForm();
  }
}

function renderCategoryFilters() {
  const allButton = categoryButton("Все", null);
  const buttons = state.categories.map((category) => categoryButton(category.name, category.id));
  elements.categoryFilters.replaceChildren(allButton, ...buttons);
}

function categoryButton(label, categoryId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `category-chip${state.activeCategoryId === categoryId ? " active" : ""}`;
  button.textContent = label;
  button.setAttribute("aria-pressed", state.activeCategoryId === categoryId ? "true" : "false");
  button.addEventListener("click", async () => {
    state.activeCategoryId = categoryId;
    renderCategoryFilters();
    await loadRecipes();
  });
  return button;
}

function renderCategoryOptions() {
  elements.categoryOptions.replaceChildren(
    ...state.categories.map((category) => {
      const option = document.createElement("option");
      option.value = category.name;
      return option;
    }),
  );
}

function renderList() {
  elements.resultCount.textContent = String(state.recipes.length);
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
        <strong class="recipe-title">${escapeHtml(recipe.title)}</strong>
        <span class="recipe-item-meta">
          <span class="tag">${escapeHtml(recipe.category)}</span>
          <span class="tag">${recipe.cookingMinutes} мин.</span>
          <span class="tag">${formatRating(recipe.averageRating)}</span>
        </span>
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
    .map((item) => `
      <li>
        <span>${escapeHtml(item.name)}</span>
        <strong>${formatQuantity(item.quantity)} ${escapeHtml(item.unit)}${item.note ? `, ${escapeHtml(item.note)}` : ""}</strong>
      </li>
    `)
    .join("");
  elements.recipeDetail.innerHTML = `
    <p class="detail-kicker">${escapeHtml(recipe.category)}</p>
    <h2>${escapeHtml(recipe.title)}</h2>
    <p class="description">${escapeHtml(recipe.description)}</p>
    <div class="meta">
      <span>${recipe.cookingMinutes} мин.</span>
      <span>${escapeHtml(recipe.difficulty)}</span>
      <span>избранное: ${recipe.favoriteCount}</span>
      <span>${formatRating(recipe.averageRating)}</span>
    </div>
    <h3 class="section-title">Ингредиенты</h3>
    <ul class="ingredients">${ingredients}</ul>
    <h3 class="section-title">Шаги</h3>
    <p class="instructions">${escapeHtml(recipe.instructions)}</p>
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
  clearForm();
  elements.categoryInput.value = state.categories[0]?.name ?? "завтраки";
  elements.difficultyInput.value = "простая";
  elements.minutesInput.value = "20";
  elements.ingredientsInput.value = "ингредиент | 1 | шт |";
  elements.recipeDetail.innerHTML = '<p class="detail-empty">Новый рецепт</p>';
  renderList();
}

function clearForm() {
  elements.recipeId.value = "";
  elements.titleInput.value = "";
  elements.categoryInput.value = "";
  elements.minutesInput.value = "20";
  elements.difficultyInput.value = "простая";
  elements.descriptionInput.value = "";
  elements.instructionsInput.value = "";
  elements.ingredientsInput.value = "";
}

async function saveRecipe(event) {
  event.preventDefault();
  try {
    setBusy(true);
    const recipe = readForm();
    const recipeId = elements.recipeId.value;
    const path = recipeId
      ? `/api/recipes/${recipeId}`
      : `/api/recipes?authorTelegramId=${DEMO_TELEGRAM_ID}`;
    const method = recipeId ? "PUT" : "POST";
    const saved = await api(path, { method, body: recipe });
    state.currentRecipe = saved;
    await Promise.all([loadStats(), loadCategories()]);
    await loadRecipes();
    await selectRecipe(saved.id);
    showToast("Рецепт сохранен");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось сохранить рецепт");
  } finally {
    setBusy(false);
  }
}

async function deleteCurrentRecipe() {
  const recipeId = elements.recipeId.value;
  if (!recipeId || !window.confirm("Удалить рецепт?")) {
    return;
  }
  try {
    setBusy(true);
    await api(`/api/recipes/${recipeId}`, { method: "DELETE" });
    state.currentRecipe = null;
    await Promise.all([loadStats(), loadRecipes()]);
    startNewRecipe();
    showToast("Рецепт удален");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось удалить рецепт");
  } finally {
    setBusy(false);
  }
}

async function addCurrentFavorite() {
  const recipeId = elements.recipeId.value;
  if (!recipeId) {
    return;
  }
  try {
    await api(`/api/users/${DEMO_TELEGRAM_ID}/favorites/${recipeId}`, { method: "POST" });
    await selectRecipe(Number(recipeId));
    await loadStats();
    showToast("Добавлено в избранное");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось добавить в избранное");
  }
}

async function rateCurrentRecipe() {
  const recipeId = elements.recipeId.value;
  if (!recipeId) {
    return;
  }
  try {
    await api(`/api/users/${DEMO_TELEGRAM_ID}/ratings/${recipeId}`, {
      method: "POST",
      body: { stars: 5, comment: "Оценка из онлайн-dashboard" },
    });
    await selectRecipe(Number(recipeId));
    await loadStats();
    showToast("Оценка сохранена");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось сохранить оценку");
  }
}

function readForm() {
  return {
    title: elements.titleInput.value.trim(),
    category: elements.categoryInput.value.trim(),
    cookingMinutes: Number(elements.minutesInput.value),
    difficulty: elements.difficultyInput.value.trim(),
    description: elements.descriptionInput.value.trim(),
    instructions: elements.instructionsInput.value.trim(),
    ingredients: parseIngredients(elements.ingredientsInput.value),
  };
}

function parseIngredients(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", quantity = "1", unit = "г", note = ""] = line
        .split("|")
        .map((part) => part.trim());
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

function setBusy(isBusy) {
  elements.saveButton.disabled = isBusy;
  elements.deleteButton.disabled = isBusy;
  elements.favoriteButton.disabled = isBusy;
  elements.rateButton.disabled = isBusy;
}

function showToast(message) {
  window.clearTimeout(showToast.timer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

function formatRating(value) {
  return value === null ? "без оценок" : `рейтинг ${value}/5`;
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
