import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(readText(path));

const repositorySource = readText("src/worker/repository.ts");
const workerSource = readText("src/worker/index.ts");
const dashboardSource = readText("docs/assets/app.js");
const apiReferenceSource = readText("docs/assets/api-reference.js");
const dashboardHtml = readText("docs/index.html");
const apiReferenceHtml = readText("docs/api-reference.html");
const evidence = readJson("docs/assets/api-evidence.json");

function onlineOperationNames() {
  const match = repositorySource.match(/onlineCrudOperationNames\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(match, "onlineCrudOperationNames list must exist");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function caseFor(method, pathMatcher) {
  return evidence.cases.find((item) => {
    if (item.method !== method) {
      return false;
    }
    if (typeof pathMatcher === "string") {
      return item.path === pathMatcher;
    }
    return pathMatcher.test(item.path);
  });
}

test("published API evidence covers every online operation", () => {
  const operations = onlineOperationNames();
  assert.equal(operations.length, 21);

  const healthCase = caseFor("GET", "/api/health");
  assert.ok(healthCase, "health endpoint evidence is required");
  assert.deepEqual(healthCase.responseBody.crudOperations, operations);

  const requiredCoverage = [
    ["health", "GET", "/api/health"],
    ["recipe_statistics", "GET", "/api/stats"],
    ["list_categories", "GET", "/api/categories"],
    ["list_ingredients", "GET", "/api/ingredients"],
    ["search_recipes", "GET", /^\/api\/recipes\?/],
    ["get_recipe", "GET", /^\/api\/recipes\/\d+$/],
    ["create_recipe", "POST", /^\/api\/recipes\?authorTelegramId=\d+$/],
    ["update_recipe", "PUT", /^\/api\/recipes\/\d+$/],
    ["delete_recipe", "DELETE", /^\/api\/recipes\/\d+$/],
    ["list_users", "GET", "/api/users"],
    ["ensure_user", "POST", "/api/users"],
    ["list_favorites", "GET", /^\/api\/users\/\d+\/favorites$/],
    ["add_favorite", "POST", /^\/api\/users\/\d+\/favorites\/\d+$/],
    ["remove_favorite", "DELETE", /^\/api\/users\/\d+\/favorites\/\d+$/],
    ["list_user_ratings", "GET", /^\/api\/users\/\d+\/ratings$/],
    ["rate_recipe", "POST", /^\/api\/users\/\d+\/ratings\/\d+$/],
    ["telegram_webhook", "POST", "/telegram/webhook"],
    ["dashboard_auth_status", "GET", "/api/dashboard-auth/status"],
    ["dashboard_auth_setup", "POST", "/api/dashboard-auth/setup"],
    ["dashboard_auth_login", "POST", "/api/dashboard-auth/login"],
  ];

  const coveredOperations = new Set();
  for (const [operation, method, matcher] of requiredCoverage) {
    const matched = caseFor(method, matcher);
    assert.ok(matched, `${operation} must have API evidence`);
    coveredOperations.add(operation);
  }

  assert.ok(
    JSON.stringify(evidence.cases).includes("averageRating"),
    "average_rating is covered through recipe/rating responses",
  );
  coveredOperations.add("average_rating");
  assert.deepEqual(new Set(operations), coveredOperations);
});

test("Worker source exposes the documented routes and safeguards", () => {
  for (const routeFragment of [
    "/telegram/webhook",
    "dashboard-auth",
    "categories",
    "ingredients",
    "recipes",
    "users",
    "favorites",
    "ratings",
  ]) {
    assert.match(workerSource, new RegExp(routeFragment.replace("/", "\\/")));
  }

  assert.match(workerSource, /parsePositiveInt/);
  assert.match(workerSource, /parseNonNegativeInt/);
  assert.match(workerSource, /readDashboardSessionToken/);
  assert.match(repositorySource, /PBKDF2-SHA-256/);
  assert.match(repositorySource, /DASHBOARD_SESSION_TTL_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
});

test("dashboard and API reference pages are wired to the deployed API contract", () => {
  assert.equal(evidence.baseUrl, "https://recipe-book-online-api-2026.egory780.workers.dev");
  assert.ok(Array.isArray(evidence.cases));
  assert.ok(evidence.cases.length >= 23);

  for (const status of [200, 201, 204, 401, 409]) {
    assert.ok(evidence.cases.some((item) => item.status === status), `HTTP ${status} evidence`);
  }

  assert.match(dashboardSource, /const API_BASE = "https:\/\/recipe-book-online-api-2026\.egory780\.workers\.dev"/);
  assert.match(apiReferenceSource, /assets\/api-evidence\.json/);
  assert.match(dashboardHtml, /assets\/app\.js/);
  assert.match(apiReferenceHtml, /assets\/api-reference\.js/);
  assert.match(dashboardSource, /dashboard-auth\/status/);
  assert.match(dashboardSource, /dashboard-auth\/login/);
});
