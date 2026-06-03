const API_BASE = "https://recipe-book-online-api-2026.egory780.workers.dev";
const DEFAULT_USER = Object.freeze({
  telegramId: 1001,
  fullName: "Редактор рецептов",
  username: "recipe_editor",
});
const STORAGE_USER_KEY = "recipeBookDashboardUserTelegramId";
const PAGE_SIZE = 50;
const INITIAL_VISIBLE_LIMIT = 36;

const state = {
  recipes: [],
  categories: [],
  ingredients: [],
  users: [],
  currentUser: null,
  favorites: new Set(),
  userRatings: new Map(),
  currentRecipe: null,
  stats: null,
  activeCategoryId: null,
  mode: "catalog",
  detailTab: "detail",
  visibleLimit: INITIAL_VISIBLE_LIMIT,
};

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  statRecipes: document.querySelector("#statRecipes"),
  statUsers: document.querySelector("#statUsers"),
  statCategories: document.querySelector("#statCategories"),
  statIngredients: document.querySelector("#statIngredients"),
  statFavorites: document.querySelector("#statFavorites"),
  statRatings: document.querySelector("#statRatings"),
  userSelect: document.querySelector("#userSelect"),
  userTelegramInput: document.querySelector("#userTelegramInput"),
  userNameInput: document.querySelector("#userNameInput"),
  userUsernameInput: document.querySelector("#userUsernameInput"),
  saveUserButton: document.querySelector("#saveUserButton"),
  categoryFilters: document.querySelector("#categoryFilters"),
  categoryOptions: document.querySelector("#categoryOptions"),
  difficultyFilter: document.querySelector("#difficultyFilter"),
  timeFilter: document.querySelector("#timeFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  resultCount: document.querySelector("#resultCount"),
  recipeList: document.querySelector("#recipeList"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  analyticsView: document.querySelector("#analyticsView"),
  insightGrid: document.querySelector("#insightGrid"),
  recipeDetail: document.querySelector("#recipeDetail"),
  recipeForm: document.querySelector("#recipeForm"),
  searchInput: document.querySelector("#searchInput"),
  refreshButton: document.querySelector("#refreshButton"),
  newButton: document.querySelector("#newButton"),
  deleteButton: document.querySelector("#deleteButton"),
  saveButton: document.querySelector("#saveButton"),
  modeButtons: document.querySelectorAll("[data-mode]"),
  detailTabButtons: document.querySelectorAll("[data-detail-tab]"),
  modeEyebrow: document.querySelector("#modeEyebrow"),
  workspaceTitle: document.querySelector("#workspaceTitle"),
  detailTabButton: document.querySelector("#detailTabButton"),
  editorTabButton: document.querySelector("#editorTabButton"),
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
  elements.searchInput.addEventListener("input", debounce(resetLimitAndRender, 180));
  elements.difficultyFilter.addEventListener("change", resetLimitAndRender);
  elements.timeFilter.addEventListener("change", resetLimitAndRender);
  elements.sortSelect.addEventListener("change", resetLimitAndRender);
  elements.userSelect.addEventListener("change", () => switchUser(Number(elements.userSelect.value)));
  elements.saveUserButton.addEventListener("click", () => saveDashboardUser());
  elements.loadMoreButton.addEventListener("click", () => {
    state.visibleLimit += INITIAL_VISIBLE_LIMIT;
    renderWorkspace();
  });
  elements.recipeForm.addEventListener("submit", (event) => saveRecipe(event));
  elements.deleteButton.addEventListener("click", () => deleteCurrentRecipe());
  for (const button of elements.modeButtons) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  for (const button of elements.detailTabButtons) {
    button.addEventListener("click", () => setDetailTab(button.dataset.detailTab));
  }
  loadAll();
}

async function loadAll() {
  setStatus("Синхронизация", "");
  setBusy(true);
  try {
    await ensureDefaultUser();
    const [stats, users, categories, ingredients] = await Promise.all([
      api("/api/stats"),
      api("/api/users"),
      api("/api/categories"),
      api("/api/ingredients"),
    ]);
    state.stats = stats;
    state.users = users;
    state.categories = categories;
    state.ingredients = ingredients;
    selectInitialUser();
    await Promise.all([loadRecipeCatalogue(), loadUserState()]);
    renderStaticData();
    if (state.currentRecipe === null && state.recipes.length > 0) {
      await selectRecipe(state.recipes[0].id, { render: false });
    }
    renderWorkspace();
    renderDetail();
    setStatus("Online D1", "online");
  } catch (error) {
    setStatus("Ошибка API", "error");
    showToast(error instanceof Error ? error.message : "Не удалось загрузить данные");
  } finally {
    setBusy(false);
  }
}

async function loadRecipeCatalogue() {
  const recipes = [];
  const seen = new Set();
  let offset = 0;
  while (offset < 1000) {
    setStatus(`Загрузка ${recipes.length}`, "");
    const page = await api(`/api/recipes?limit=${PAGE_SIZE}&offset=${offset}`);
    const fresh = page.filter((recipe) => !seen.has(recipe.id));
    for (const recipe of fresh) {
      recipes.push(recipe);
      seen.add(recipe.id);
    }
    if (page.length < PAGE_SIZE || fresh.length === 0) {
      break;
    }
    offset += PAGE_SIZE;
  }
  state.recipes = recipes;
}

async function loadUsers() {
  state.users = await api("/api/users");
  if (state.currentUser !== null) {
    state.currentUser =
      state.users.find((user) => user.telegramId === state.currentUser.telegramId) ?? state.currentUser;
  }
}

async function loadUserState() {
  if (state.currentUser === null) {
    state.favorites = new Set();
    state.userRatings = new Map();
    return;
  }
  const telegramId = state.currentUser.telegramId;
  const [favorites, ratings] = await Promise.all([
    api(`/api/users/${telegramId}/favorites`),
    api(`/api/users/${telegramId}/ratings`),
  ]);
  state.favorites = new Set(favorites.map((recipe) => recipe.id));
  state.userRatings = new Map(ratings.map((recipe) => [recipe.id, recipe.userRating]));
}

async function loadStatsAndUserState() {
  if (state.currentUser === null) {
    return;
  }
  const telegramId = state.currentUser.telegramId;
  const [stats, favorites, ratings] = await Promise.all([
    api("/api/stats"),
    api(`/api/users/${telegramId}/favorites`),
    api(`/api/users/${telegramId}/ratings`),
  ]);
  state.stats = stats;
  state.favorites = new Set(favorites.map((recipe) => recipe.id));
  state.userRatings = new Map(ratings.map((recipe) => [recipe.id, recipe.userRating]));
}

function renderStaticData() {
  const stats = state.stats ?? {};
  elements.statRecipes.textContent = stats.recipes ?? 0;
  elements.statUsers.textContent = stats.users ?? state.users.length;
  elements.statCategories.textContent = stats.categories ?? 0;
  elements.statIngredients.textContent = stats.ingredients ?? 0;
  elements.statFavorites.textContent = stats.favorites ?? 0;
  elements.statRatings.textContent = stats.ratings ?? 0;
  renderUsers();
  renderCategoryFilters();
  renderCategoryOptions();
  renderDifficultyOptions();
}

function renderUsers() {
  const users = [...state.users];
  if (state.currentUser !== null && !users.some((user) => user.telegramId === state.currentUser.telegramId)) {
    users.unshift(state.currentUser);
  }
  elements.userSelect.replaceChildren(
    ...users.map((user) => optionElement(String(user.telegramId), displayUserLabel(user))),
  );
  if (state.currentUser !== null) {
    elements.userSelect.value = String(state.currentUser.telegramId);
    elements.userTelegramInput.value = String(state.currentUser.telegramId);
    elements.userNameInput.value = state.currentUser.fullName;
    elements.userUsernameInput.value = state.currentUser.username ?? "";
  }
}

function renderCategoryFilters() {
  const buttons = [
    categoryButton("Все", null),
    ...state.categories.map((category) => categoryButton(category.name, category.id)),
  ];
  elements.categoryFilters.replaceChildren(...buttons);
}

function categoryButton(label, categoryId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `category-chip${state.activeCategoryId === categoryId ? " active" : ""}`;
  button.textContent = label;
  button.setAttribute("aria-pressed", state.activeCategoryId === categoryId ? "true" : "false");
  button.addEventListener("click", () => {
    state.activeCategoryId = categoryId;
    state.visibleLimit = INITIAL_VISIBLE_LIMIT;
    renderCategoryFilters();
    renderWorkspace();
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

function renderDifficultyOptions() {
  const values = uniqueSorted(state.recipes.map((recipe) => recipe.difficulty));
  elements.difficultyFilter.replaceChildren(
    optionElement("", "Любая"),
    ...values.map((value) => optionElement(value, value)),
  );
}

function renderWorkspace() {
  renderModeButtons();
  const recipes = getVisibleRecipes();
  const total = state.mode === "favorites" ? state.favorites.size : state.recipes.length;
  const shown = state.mode === "analytics" ? recipes.length : Math.min(recipes.length, state.visibleLimit);
  elements.resultCount.textContent = `${shown} / ${recipes.length} / ${total}`;
  elements.resultCount.title = `${shown} показано, ${recipes.length} найдено, ${total} всего`;
  elements.modeEyebrow.textContent = modeLabel(state.mode);
  elements.workspaceTitle.textContent = workspaceTitle();
  elements.insightGrid.hidden = false;
  renderInsights(recipes);
  if (state.mode === "analytics") {
    elements.recipeList.hidden = true;
    elements.loadMoreButton.hidden = true;
    elements.analyticsView.hidden = false;
    renderAnalytics();
    return;
  }
  elements.analyticsView.hidden = true;
  elements.recipeList.hidden = false;
  renderRecipeCards(recipes.slice(0, state.visibleLimit));
  elements.loadMoreButton.hidden = recipes.length <= state.visibleLimit;
}

function renderModeButtons() {
  for (const button of elements.modeButtons) {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  }
}

function setMode(mode) {
  state.mode = mode;
  state.visibleLimit = INITIAL_VISIBLE_LIMIT;
  if (mode === "analytics") {
    setDetailTab("detail");
  }
  renderWorkspace();
}

function modeLabel(mode) {
  if (mode === "favorites") {
    return "Мои";
  }
  if (mode === "analytics") {
    return "Статистика";
  }
  return "Каталог";
}

function workspaceTitle() {
  const category = selectedCategoryName();
  if (state.mode === "favorites") {
    return category === null ? "Мои рецепты" : `Мои: ${category}`;
  }
  if (state.mode === "analytics") {
    return "Статистика";
  }
  return category === null ? "Все рецепты" : category;
}

function getVisibleRecipes() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const categoryName = selectedCategoryName();
  const difficulty = elements.difficultyFilter.value;
  const maxMinutes = Number(elements.timeFilter.value || 0);
  let recipes = [...state.recipes];
  if (state.mode === "favorites") {
    recipes = recipes.filter((recipe) => state.favorites.has(recipe.id));
  }
  if (categoryName !== null) {
    recipes = recipes.filter((recipe) => recipe.category === categoryName);
  }
  if (difficulty.length > 0) {
    recipes = recipes.filter((recipe) => recipe.difficulty === difficulty);
  }
  if (maxMinutes > 0) {
    recipes = recipes.filter((recipe) => recipe.cookingMinutes <= maxMinutes);
  }
  if (query.length > 0) {
    recipes = recipes.filter((recipe) =>
      [recipe.title, recipe.description, recipe.category, recipe.difficulty]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }
  return sortRecipes(recipes, elements.sortSelect.value);
}

function sortRecipes(recipes, sortMode) {
  const collator = new Intl.Collator("ru");
  return recipes.sort((left, right) => {
    if (sortMode === "category") {
      return (
        collator.compare(left.category, right.category) ||
        collator.compare(left.title, right.title)
      );
    }
    if (sortMode === "minutes") {
      return left.cookingMinutes - right.cookingMinutes || collator.compare(left.title, right.title);
    }
    if (sortMode === "rating") {
      return (
        (right.averageRating ?? -1) - (left.averageRating ?? -1) ||
        right.ratingCount - left.ratingCount ||
        collator.compare(left.title, right.title)
      );
    }
    if (sortMode === "favoriteCount") {
      return right.favoriteCount - left.favoriteCount || collator.compare(left.title, right.title);
    }
    if (sortMode === "myRating") {
      return (
        personalRatingValue(right.id) - personalRatingValue(left.id) ||
        (right.averageRating ?? -1) - (left.averageRating ?? -1) ||
        collator.compare(left.title, right.title)
      );
    }
    if (sortMode === "created") {
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    }
    return collator.compare(left.title, right.title);
  });
}

function renderInsights(recipes) {
  const topCategory = topEntry(countBy(recipes, (recipe) => recipe.category));
  const avgTime = recipes.length === 0 ? 0 : Math.round(sum(recipes, "cookingMinutes") / recipes.length);
  const rated = recipes.filter((recipe) => recipe.averageRating !== null).length;
  const currentRated = recipes.filter((recipe) => state.userRatings.has(recipe.id)).length;
  elements.insightGrid.replaceChildren(
    insightCard(String(recipes.length), "рецептов"),
    insightCard(avgTime === 0 ? "-" : `${avgTime} мин`, "среднее время"),
    insightCard(topCategory === null ? "-" : topCategory[0], "топ категория"),
    insightCard(String(rated), "с оценками"),
    insightCard(String(currentRated), "мои оценки"),
    insightCard(String(state.favorites.size), "мое избранное"),
  );
}

function insightCard(value, label) {
  const card = document.createElement("div");
  card.className = "insight";
  card.innerHTML = `<strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>`;
  return card;
}

function renderRecipeCards(recipes) {
  if (recipes.length === 0) {
    elements.recipeList.innerHTML = '<div class="empty-state">Нет рецептов под выбранные фильтры.</div>';
    elements.loadMoreButton.hidden = true;
    return;
  }
  elements.recipeList.replaceChildren(
    ...recipes.map((recipe) => {
      const userRating = state.userRatings.get(recipe.id);
      const isFavorite = state.favorites.has(recipe.id);
      const personalChips = [
        userRating ? `<span class="chip metric-chip strong" title="Моя оценка">${iconMarkup("star")}<span>моя ${userRating.stars}/5</span></span>` : "",
        isFavorite ? `<span class="chip metric-chip positive" title="В моем избранном">${iconMarkup("heart")}<span>мое</span></span>` : "",
      ].join("");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `recipe-card${state.currentRecipe?.id === recipe.id ? " active" : ""}`;
      button.innerHTML = `
        <span class="card-top">
          <strong>${escapeHtml(recipe.title)}</strong>
          ${isFavorite ? `<span class="favorite-dot" title="В моем избранном">${iconMarkup("heart")}</span>` : ""}
        </span>
        <span class="card-meta">
          <span class="chip">${escapeHtml(recipe.category)}</span>
          <span class="chip">${recipe.cookingMinutes} мин</span>
          <span class="chip">${escapeHtml(recipe.difficulty)}</span>
        </span>
        <span class="card-description">${escapeHtml(trimText(recipe.description, 96))}</span>
        <span class="chip-row">
          <span class="chip metric-chip" title="Средний рейтинг">${iconMarkup("star")}<span>${formatRating(recipe.averageRating)}</span></span>
          <span class="chip metric-chip" title="Оценок всего">${iconMarkup("user")}<span>${recipe.ratingCount}</span></span>
          <span class="chip metric-chip" title="В избранном всего">${iconMarkup("heart")}<span>${recipe.favoriteCount}</span></span>
          ${personalChips}
        </span>
      `;
      button.addEventListener("click", () => selectRecipe(recipe.id));
      return button;
    }),
  );
}

function resetLimitAndRender() {
  state.visibleLimit = INITIAL_VISIBLE_LIMIT;
  renderWorkspace();
}

function renderAnalytics() {
  const stats = state.stats ?? {};
  const byCategory = entriesByCount(countBy(state.recipes, (recipe) => recipe.category));
  const byDifficulty = entriesByCount(countBy(state.recipes, (recipe) => recipe.difficulty));
  const fastRecipes = state.recipes.filter((recipe) => recipe.cookingMinutes <= 30).length;
  const topRated = [...state.recipes]
    .filter((recipe) => recipe.averageRating !== null)
    .sort((left, right) => (right.averageRating ?? 0) - (left.averageRating ?? 0) || right.ratingCount - left.ratingCount)
    .slice(0, 6);
  const topFavorite = [...state.recipes]
    .filter((recipe) => recipe.favoriteCount > 0)
    .sort((left, right) => right.favoriteCount - left.favoriteCount || (right.averageRating ?? 0) - (left.averageRating ?? 0))
    .slice(0, 6);
  const myRated = [...state.recipes]
    .filter((recipe) => state.userRatings.has(recipe.id))
    .sort((left, right) => personalRatingValue(right.id) - personalRatingValue(left.id))
    .slice(0, 6);
  const ingredients = state.ingredients.slice(0, 22);
  elements.analyticsView.innerHTML = `
    <section class="analytics-section analytics-summary analytics-wide">
      <h3>Общая сводка</h3>
      <div class="metric-inline-grid">
        <span><strong>${stats.users ?? state.users.length}</strong><small>люди</small></span>
        <span><strong>${stats.favorites ?? 0}</strong><small>избранное</small></span>
        <span><strong>${stats.ratings ?? 0}</strong><small>оценок</small></span>
        <span><strong>${stats.recipes ?? state.recipes.length}</strong><small>рецептов</small></span>
      </div>
      <p class="muted-line">${escapeHtml(shortUserLabel())}: ${state.favorites.size} избран., ${state.userRatings.size} оценки.</p>
    </section>
    ${barSection("Категории", byCategory, "bar-section")}
    ${barSection("Сложность", byDifficulty, "bar-section")}
    <section class="analytics-section analytics-wide">
      <h3>Показатели</h3>
      <div class="chip-row">
        <span class="chip">быстрые: ${fastRecipes}</span>
        <span class="chip">мои избранные: ${state.favorites.size}</span>
        <span class="chip">мои оценки: ${state.userRatings.size}</span>
        <span class="chip">ингредиенты: ${state.ingredients.length}</span>
      </div>
    </section>
    <div class="analytics-rankings analytics-wide">
      <section class="analytics-section ranking-section">
        <h3>Рейтинг</h3>
        ${recipeButtonList(topRated, (recipe) => `${formatRating(recipe.averageRating)} · ${recipe.ratingCount}`)}
      </section>
      <section class="analytics-section ranking-section">
        <h3>Избранное</h3>
        ${recipeButtonList(topFavorite, (recipe) => `${recipe.favoriteCount} · ${formatRating(recipe.averageRating)}`)}
      </section>
      <section class="analytics-section ranking-section">
        <h3>Мои оценки</h3>
        ${recipeButtonList(myRated, (recipe) => `моя ${personalRatingValue(recipe.id)}/5 · всего ${formatRating(recipe.averageRating)}`)}
      </section>
    </div>
    <section class="analytics-section analytics-wide">
      <h3>Ингредиенты</h3>
      <div class="chip-row">${ingredients.map((item) => `<span class="chip">${escapeHtml(item.name)} · ${escapeHtml(item.unit)}</span>`).join("")}</div>
    </section>
  `;
  for (const button of elements.analyticsView.querySelectorAll("[data-analytics-recipe]")) {
    button.addEventListener("click", () => selectRecipe(Number(button.dataset.analyticsRecipe)));
  }
}

function recipeButtonList(recipes, metaMapper) {
  if (recipes.length === 0) {
    return '<p class="empty-state">Данных пока мало.</p>';
  }
  return recipes
    .map(
      (recipe) =>
        `<button class="ghost-button wide analytics-recipe-button" type="button" data-analytics-recipe="${recipe.id}">
          <span>${escapeHtml(recipe.title)}</span>
          <small>${escapeHtml(metaMapper(recipe))}</small>
        </button>`,
    )
    .join("");
}

function barSection(title, entries, className = "") {
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  const sectionClass = ["analytics-section", className].filter(Boolean).join(" ");
  return `
    <section class="${sectionClass}">
      <h3>${escapeHtml(title)}</h3>
      ${entries
        .map(([label, value]) => {
          const width = Math.max(Math.round((value / max) * 100), 4);
          return `
            <div class="bar-row">
              <span class="bar-label">${escapeHtml(label)}</span>
              <span class="bar-track"><span class="bar-fill" style="width: ${width}%"></span></span>
              <span class="bar-value">${value}</span>
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

async function selectRecipe(recipeId, options = { render: true }) {
  const recipe = await api(`/api/recipes/${recipeId}`);
  state.currentRecipe = recipe;
  upsertSummary(recipe);
  fillForm(recipe);
  if (options.render) {
    setDetailTab("detail");
    renderWorkspace();
    renderDetail();
  }
}

function renderDetail() {
  renderDetailTabs();
  if (state.currentRecipe === null) {
    elements.recipeDetail.innerHTML = '<div class="empty-state">Выберите рецепт или создайте новый.</div>';
    return;
  }
  const recipe = state.currentRecipe;
  const ingredients = recipe.ingredients
    .map((item) => `
      <li>
        <span>${escapeHtml(item.name)}</span>
        <strong>${formatQuantity(item.quantity)} ${escapeHtml(item.unit)}${item.note ? `, ${escapeHtml(item.note)}` : ""}</strong>
      </li>
    `)
    .join("");
  const isFavorite = state.favorites.has(recipe.id);
  const userRating = state.userRatings.get(recipe.id);
  const favoriteText = isFavorite ? "Убрать" : "В избранное";
  const favoriteTitle = isFavorite ? "Убрать из моего избранного" : "Добавить в мое избранное";
  elements.recipeDetail.innerHTML = `
    <p class="detail-kicker">${escapeHtml(recipe.category)}</p>
    <h2>${escapeHtml(recipe.title)}</h2>
    <p class="detail-description">${escapeHtml(recipe.description)}</p>
    <div class="user-context">
      <span>${escapeHtml(displayUserLabel(state.currentUser))}</span>
      <strong>${userRating ? `моя: ${userRating.stars}/5` : "моя: нет"}</strong>
    </div>
    <div class="chip-row">
      <span class="chip">${recipe.cookingMinutes} мин</span>
      <span class="chip">${escapeHtml(recipe.difficulty)}</span>
      <span class="chip metric-chip" title="Средний рейтинг">${iconMarkup("star")}<span>${formatRating(recipe.averageRating)}</span></span>
      <span class="chip metric-chip" title="Оценок всего">${iconMarkup("user")}<span>${recipe.ratingCount}</span></span>
      <span class="chip metric-chip" title="В избранном всего">${iconMarkup("heart")}<span>${recipe.favoriteCount}</span></span>
      ${isFavorite ? `<span class="chip metric-chip positive" title="В моем избранном">${iconMarkup("heart")}<span>мое</span></span>` : ""}
    </div>
    <div class="detail-actions">
      <button id="toggleFavoriteButton" class="secondary-button" type="button" title="${favoriteTitle}" aria-label="${favoriteTitle}">
        ${iconMarkup("heart")}
        <span>${favoriteText}</span>
      </button>
      <select id="ratingSelect" class="rating-select" aria-label="Оценка">
        <option value="5">5</option>
        <option value="4">4</option>
        <option value="3">3</option>
        <option value="2">2</option>
        <option value="1">1</option>
      </select>
      <button id="rateRecipeButton" class="secondary-button icon-command" type="button" title="Оценить" aria-label="Оценить">
        ${iconMarkup("star")}
        <span class="visually-hidden">Оценить</span>
      </button>
      <button id="openEditorButton" class="ghost-button" type="button">
        ${iconMarkup("edit")}
        <span>Редактор</span>
      </button>
    </div>
    <h3 class="section-title">Состав</h3>
    <ul class="ingredients">${ingredients}</ul>
    <h3 class="section-title">Шаги</h3>
    <p class="instructions">${escapeHtml(recipe.instructions)}</p>
  `;
  const ratingSelect = document.querySelector("#ratingSelect");
  ratingSelect.value = String(userRating?.stars ?? 5);
  document.querySelector("#toggleFavoriteButton").addEventListener("click", toggleCurrentFavorite);
  document.querySelector("#rateRecipeButton").addEventListener("click", () => {
    const stars = Number(ratingSelect.value);
    rateCurrentRecipe(stars);
  });
  document.querySelector("#openEditorButton").addEventListener("click", () => setDetailTab("editor"));
}

function setDetailTab(tab) {
  state.detailTab = tab;
  renderDetailTabs();
}

function renderDetailTabs() {
  for (const button of elements.detailTabButtons) {
    button.classList.toggle("active", button.dataset.detailTab === state.detailTab);
  }
  const showEditor = state.detailTab === "editor";
  elements.recipeForm.hidden = !showEditor;
  elements.recipeDetail.hidden = showEditor;
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
  elements.categoryInput.value = selectedCategoryName() ?? state.categories[0]?.name ?? "завтраки";
  elements.difficultyInput.value = "простая";
  elements.minutesInput.value = "20";
  elements.ingredientsInput.value = "ингредиент | 1 | г |";
  setDetailTab("editor");
  renderWorkspace();
  showToast("Заполните редактор и сохраните рецепт");
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
  setBusy(true);
  try {
    const recipe = readForm();
    const recipeId = elements.recipeId.value;
    const telegramId = requireCurrentTelegramId();
    const path = recipeId ? `/api/recipes/${recipeId}` : `/api/recipes?authorTelegramId=${telegramId}`;
    const method = recipeId ? "PUT" : "POST";
    const saved = await api(path, { method, body: recipe });
    await Promise.all([loadStatsAndUserState(), loadRecipeCatalogue()]);
    renderStaticData();
    await selectRecipe(saved.id, { render: false });
    setDetailTab("detail");
    renderWorkspace();
    renderDetail();
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
  setBusy(true);
  try {
    await api(`/api/recipes/${recipeId}`, { method: "DELETE" });
    state.currentRecipe = null;
    clearForm();
    await Promise.all([loadStatsAndUserState(), loadRecipeCatalogue()]);
    renderStaticData();
    setDetailTab("detail");
    renderWorkspace();
    renderDetail();
    showToast("Рецепт удален");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось удалить рецепт");
  } finally {
    setBusy(false);
  }
}

async function toggleCurrentFavorite() {
  const recipeId = state.currentRecipe?.id;
  if (recipeId === undefined) {
    return;
  }
  const telegramId = requireCurrentTelegramId();
  const method = state.favorites.has(recipeId) ? "DELETE" : "POST";
  try {
    await api(`/api/users/${telegramId}/favorites/${recipeId}`, { method });
    await loadStatsAndUserState();
    await selectRecipe(recipeId, { render: false });
    renderStaticData();
    renderWorkspace();
    renderDetail();
    showToast(method === "POST" ? "Добавлено в избранное выбранного пользователя" : "Удалено из избранного выбранного пользователя");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось обновить избранное");
  }
}

async function rateCurrentRecipe(stars) {
  const recipeId = state.currentRecipe?.id;
  if (recipeId === undefined) {
    return;
  }
  const telegramId = requireCurrentTelegramId();
  try {
    await api(`/api/users/${telegramId}/ratings/${recipeId}`, {
      method: "POST",
      body: { stars, comment: `Оценка ${shortUserLabel()} из онлайн-dashboard` },
    });
    await loadStatsAndUserState();
    await selectRecipe(recipeId, { render: false });
    renderStaticData();
    renderWorkspace();
    renderDetail();
    showToast(`Оценка ${stars}/5 сохранена для выбранного пользователя`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось сохранить оценку");
  }
}

async function switchUser(telegramId) {
  const user = state.users.find((item) => item.telegramId === telegramId);
  if (user === undefined) {
    return;
  }
  state.currentUser = user;
  window.localStorage.setItem(STORAGE_USER_KEY, String(user.telegramId));
  setBusy(true);
  try {
    await loadUserState();
    renderUsers();
    renderWorkspace();
    renderDetail();
    showToast(`Пользователь переключен: ${displayUserLabel(user)}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось переключить пользователя");
  } finally {
    setBusy(false);
  }
}

async function saveDashboardUser() {
  const telegramId = Number(elements.userTelegramInput.value);
  const fullName = elements.userNameInput.value.trim();
  const username = normalizeUsername(elements.userUsernameInput.value);
  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    showToast("Укажите корректный Telegram ID");
    return;
  }
  if (fullName.length === 0) {
    showToast("Укажите имя пользователя");
    return;
  }
  setBusy(true);
  try {
    await api("/api/users", {
      method: "POST",
      body: { telegramId, fullName, username },
    });
    await loadUsers();
    state.currentUser = state.users.find((user) => user.telegramId === telegramId) ?? {
      telegramId,
      fullName,
      username,
    };
    window.localStorage.setItem(STORAGE_USER_KEY, String(telegramId));
    await loadStatsAndUserState();
    renderStaticData();
    renderWorkspace();
    renderDetail();
    showToast("Пользователь сохранен");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Не удалось сохранить пользователя");
  } finally {
    setBusy(false);
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

async function ensureDefaultUser() {
  await api("/api/users", {
    method: "POST",
    body: DEFAULT_USER,
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
  elements.refreshButton.disabled = isBusy;
  elements.newButton.disabled = isBusy;
  elements.saveUserButton.disabled = isBusy;
  elements.userSelect.disabled = isBusy;
}

function showToast(message) {
  window.clearTimeout(showToast.timer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2600);
}

function selectInitialUser() {
  const stored = Number(window.localStorage.getItem(STORAGE_USER_KEY));
  const user =
    state.users.find((item) => Number.isInteger(stored) && item.telegramId === stored) ??
    state.users.find((item) => item.telegramId === DEFAULT_USER.telegramId) ??
    state.users[0] ??
    DEFAULT_USER;
  state.currentUser = user;
  window.localStorage.setItem(STORAGE_USER_KEY, String(user.telegramId));
}

function requireCurrentTelegramId() {
  if (state.currentUser === null) {
    throw new Error("Выберите пользователя");
  }
  return state.currentUser.telegramId;
}

function selectedCategoryName() {
  if (state.activeCategoryId === null) {
    return null;
  }
  return state.categories.find((category) => category.id === state.activeCategoryId)?.name ?? null;
}

function optionElement(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort(new Intl.Collator("ru").compare);
}

function countBy(items, mapper) {
  const result = new Map();
  for (const item of items) {
    const key = mapper(item);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

function entriesByCount(map) {
  return [...map.entries()].sort((left, right) => right[1] - left[1]);
}

function topEntry(map) {
  return entriesByCount(map)[0] ?? null;
}

function sum(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}

function upsertSummary(recipe) {
  let replaced = false;
  state.recipes = state.recipes.map((item) => {
    if (item.id === recipe.id) {
      replaced = true;
      return summaryFromDetails(recipe);
    }
    return item;
  });
  if (!replaced) {
    state.recipes.unshift(summaryFromDetails(recipe));
  }
}

function summaryFromDetails(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    cookingMinutes: recipe.cookingMinutes,
    difficulty: recipe.difficulty,
    category: recipe.category,
    authorName: recipe.authorName,
    favoriteCount: recipe.favoriteCount,
    ratingCount: recipe.ratingCount,
    averageRating: recipe.averageRating,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

function personalRatingValue(recipeId) {
  return state.userRatings.get(recipeId)?.stars ?? -1;
}

function displayUserLabel(user) {
  if (user === null || user === undefined) {
    return "пользователь не выбран";
  }
  const username = user.username ? `@${user.username}` : `id ${user.telegramId}`;
  return `${user.fullName} · ${username}`;
}

function shortUserLabel() {
  if (state.currentUser === null) {
    return "не выбран";
  }
  return state.currentUser.username ? `@${state.currentUser.username}` : state.currentUser.fullName;
}

function normalizeUsername(value) {
  const normalized = value.trim().replace(/^@+/, "");
  return normalized.length === 0 ? null : normalized;
}

function formatRating(value) {
  return value === null ? "нет оценок" : `${value}/5`;
}

function iconMarkup(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function trimText(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
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
