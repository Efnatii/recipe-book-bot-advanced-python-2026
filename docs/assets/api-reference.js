const API_BASE = "https://recipe-book-online-api-2026.egory780.workers.dev";
const API_EVIDENCE_PATH = "assets/api-evidence.json";

const root = document.querySelector("#apiReferenceRoot");

renderApiReference();

async function renderApiReference() {
  try {
    const response = await fetch(API_EVIDENCE_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const cases = Array.isArray(payload?.cases) ? payload.cases : [];
    root.innerHTML = apiReferenceHtml(payload, cases);
  } catch (error) {
    root.innerHTML = `
      <section class="analytics-section analytics-wide api-evidence-summary">
        <h3>API reference недоступен</h3>
        <p class="muted-line">${escapeHtml(error instanceof Error ? error.message : "Не удалось загрузить evidence-файл.")}</p>
      </section>
    `;
  }
}

function apiReferenceHtml(payload, cases) {
  if (cases.length === 0) {
    return `
      <section class="analytics-section analytics-wide api-evidence-summary">
        <h3>API reference</h3>
        <p class="muted-line">Файл с контрольными запросами пока не содержит маршрутов.</p>
      </section>
    `;
  }

  const successCount = cases.filter((item) => Number(item.status) >= 200 && Number(item.status) < 300).length;
  const guardedCount = cases.filter((item) => Number(item.status) >= 400).length;
  const baseUrl = payload.baseUrl ?? API_BASE;
  const methodStats = apiMethodStats(cases);
  const groups = [
    {
      id: "Read/list endpoints",
      title: "Чтение, поиск и справочники",
      note: "GET/OPTIONS: состояние сервиса, статистика D1, каталог, пользователи, категории и ингредиенты.",
    },
    {
      id: "Write/action endpoints",
      title: "Изменение данных и webhook",
      note: "POST/PUT/DELETE: создание пользователя и рецепта, обновление, избранное, рейтинг, удаление и защитный webhook.",
    },
    {
      id: "Dashboard protection endpoints",
      title: "Защита dashboard",
      note: "Маршруты серверного пароля: статус настройки, однократная установка и проверка входа.",
    },
  ];
  const knownGroupIds = new Set(groups.map((item) => item.id));
  const visibleGroups = [
    ...groups,
    ...uniqueValues(cases.map((item) => item.group).filter((group) => !knownGroupIds.has(group))).map(
      (group) => ({
        id: group,
        title: group,
        note: "Дополнительные контрольные маршруты опубликованного Worker API.",
      }),
    ),
  ];
  let offset = 1;
  const groupSections = visibleGroups
    .map((group) => {
      const groupCases = cases.filter((item) => item.group === group.id);
      const html = apiEvidenceGroup(group.title, group.note, groupCases, offset, baseUrl);
      offset += groupCases.length;
      return html;
    })
    .join("");

  return `
    <section class="analytics-section analytics-wide api-reference-hero">
      <div class="api-reference-copy">
        <p class="eyebrow">API reference</p>
        <h3>Worker API книги рецептов</h3>
        <p class="muted-line">Реальные маршруты опубликованного Cloudflare Worker: метод, путь, тело запроса и фактический JSON-ответ.</p>
        <code class="api-base-url">${escapeHtml(baseUrl)}</code>
      </div>
      <div class="api-reference-facts">
        <span><strong>${cases.length}</strong><small>проверенных маршрутов</small></span>
        <span><strong>${successCount}</strong><small>HTTP 2xx</small></span>
        <span><strong>${guardedCount}</strong><small>защитных отказов</small></span>
        <span><strong>${escapeHtml(formatApiDate(payload.generatedAt))}</strong><small>снимок</small></span>
      </div>
    </section>

    <section class="analytics-section analytics-wide api-reference-map">
      <div class="api-reference-section-head">
        <div>
          <h3>Карта маршрутов</h3>
          <p class="muted-line">Полный набор публичных точек входа, сгруппированный по HTTP-методам.</p>
        </div>
        <div class="api-method-summary">${methodStats.map(apiMethodStat).join("")}</div>
      </div>
      <div class="api-route-strip">
        ${cases.map((item) => apiRoutePill(item)).join("")}
      </div>
    </section>

    ${groupSections}
  `;
}

function apiEvidenceGroup(title, note, cases, offset, baseUrl) {
  if (cases.length === 0) {
    return "";
  }
  return `
    <section class="api-evidence-group analytics-wide">
      <div class="api-reference-section-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="muted-line">${escapeHtml(note)}</p>
        </div>
        <span class="api-group-count">${cases.length} маршрутов</span>
      </div>
      <div class="api-evidence-grid">
        ${cases.map((item, index) => apiEvidenceCard(item, offset + index, baseUrl)).join("")}
      </div>
    </section>
  `;
}

function apiEvidenceCard(item, index, baseUrl) {
  const status = Number(item.status);
  const method = String(item.method ?? "-");
  const path = String(item.path ?? "/");
  return `
    <article class="api-evidence-card">
      <div class="api-card-head">
        <span class="method-label method-${escapeHtml(method.toLowerCase())}">${escapeHtml(method)}</span>
        <strong>${index}. ${escapeHtml(item.title ?? "Endpoint")}</strong>
        <span class="api-status ${apiStatusClass(status)}">HTTP ${Number.isFinite(status) ? status : "-"}</span>
      </div>
      <p class="api-card-note">${escapeHtml(apiCaseDescription(item))}</p>
      <code class="api-path">${escapeHtml(path)}</code>
      <code class="api-url">${escapeHtml(`${baseUrl}${path}`)}</code>
      <div class="api-payload-grid">
        <div>
          <span class="api-payload-label">Request</span>
          <pre>${escapeHtml(apiPayloadText(item.requestBody, "Без тела запроса"))}</pre>
        </div>
        <div>
          <span class="api-payload-label">Response</span>
          <pre>${escapeHtml(apiPayloadText(item.responseBody, status === 204 ? "Без тела ответа" : "Пустой ответ"))}</pre>
        </div>
      </div>
    </article>
  `;
}

function apiMethodStats(cases) {
  const counts = new Map();
  for (const item of cases) {
    const method = String(item.method ?? "-");
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  return [...counts.entries()].map(([method, count]) => ({ method, count }));
}

function apiMethodStat(item) {
  return `
    <span class="api-method-stat method-${escapeHtml(item.method.toLowerCase())}">
      <strong>${escapeHtml(item.method)}</strong>
      <small>${item.count}</small>
    </span>
  `;
}

function apiRoutePill(item) {
  const method = String(item.method ?? "-");
  const path = String(item.path ?? "/");
  return `
    <span class="api-route-pill">
      <span class="method-label method-${escapeHtml(method.toLowerCase())}">${escapeHtml(method)}</span>
      <code>${escapeHtml(path)}</code>
    </span>
  `;
}

function apiCaseDescription(item) {
  const descriptions = {
    "Root metadata": "Паспорт сервиса и список ключевых точек входа.",
    "CORS preflight": "Предварительная проверка CORS для браузерных запросов.",
    Health: "Состояние Worker, D1 и перечень реализованных серверных операций.",
    "D1 statistics": "Сводная статистика опубликованной базы Cloudflare D1.",
    Categories: "Справочник категорий рецептов.",
    Ingredients: "Справочник ингредиентов с единицами измерения.",
    Users: "Список зарегистрированных пользователей панели и Telegram-бота.",
    "Recipes page": "Страница каталога рецептов с пагинацией.",
    "Recipes search": "Поиск рецептов по строке запроса.",
    "Ensure user": "Создание или получение пользователя по Telegram ID.",
    "Create recipe": "Создание рецепта от имени выбранного автора.",
    "Get recipe": "Чтение полной карточки рецепта по идентификатору.",
    "Update recipe": "Обновление полей рецепта и состава ингредиентов.",
    "Add favorite": "Добавление рецепта в избранное пользователя.",
    "List favorites": "Получение избранного выбранного пользователя.",
    "Remove favorite": "Удаление рецепта из избранного.",
    "Rate recipe": "Сохранение пользовательской оценки рецепта.",
    "List ratings": "Получение оценок выбранного пользователя.",
    "Delete recipe": "Удаление временного рецепта после проверки API.",
    "Telegram webhook guard": "Защитный отказ при запросе webhook без секретного заголовка.",
    "Dashboard auth status": "Проверка, создан ли единый серверный пароль dashboard, и действителен ли переданный session token.",
    "Dashboard auth setup guard": "Защитный отказ повторной установки уже созданного серверного пароля.",
    "Dashboard auth login guard": "Защитный отказ входа при неверном пароле dashboard; успешный вход выдает часовой session token.",
  };
  return descriptions[item.title] ?? "Контрольная пара запроса и ответа опубликованного Worker API.";
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function formatApiDate(value) {
  if (!value) {
    return "2026-06-04";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function apiStatusClass(status) {
  if (status >= 200 && status < 300) {
    return "ok";
  }
  if (status >= 400) {
    return "error";
  }
  return "neutral";
}

function apiPayloadText(value, emptyText = "-") {
  if (value === null || typeof value === "undefined") {
    return emptyText;
  }
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
