export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Bot-Api-Secret-Token",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function json(data: unknown, init: ResponseInit | number = 200): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : init;
  const headers = new Headers(responseInit.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(data, { ...responseInit, headers });
}

export function error(status: number, message: string, details: unknown = null): Response {
  return json({ ok: false, error: message, details }, status);
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "Expected application/json request body");
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

export function requireMethod(request: Request, expected: string): void {
  if (request.method !== expected) {
    throw new HttpError(405, `Method ${request.method} is not allowed`);
  }
}

export function parsePositiveInt(value: string | undefined, label: string): number {
  if (value === undefined) {
    throw new HttpError(400, `${label} is required`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer`);
  }
  return parsed;
}
