import { ADMIN_INACTIVITY_TIMEOUT_MS } from "./admin-session";

const AJAX_JSON_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
} as const;

export type AdminApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AdminContextRequestResult =
  | "access-login-required"
  | "failed"
  | "ready";

export type AdminActivityRequestResult =
  | "access-login-required"
  | "lock-required"
  | "refreshed";

export type AdminLockRequestResult =
  | Readonly<{ status: "access-login-required" }>
  | Readonly<{ status: "locked" }>
  | Readonly<{ retryAfterMs: number; status: "retry" }>;

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json");
}

function isLiveContext(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const context = (value as { environment?: unknown }).environment;
  if (typeof context !== "object" || context === null) return false;
  return (context as { id?: unknown }).id === "live";
}

function readRetryAfterMs(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const retryAfterMs = (value as { retryAfterMs?: unknown })
    .retryAfterMs;
  if (
    typeof retryAfterMs !== "number" ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs <= 0 ||
    retryAfterMs > ADMIN_INACTIVITY_TIMEOUT_MS
  ) {
    return null;
  }
  return retryAfterMs;
}

export async function requestAdminContext(
  options: Readonly<{
    fetcher?: AdminApiFetch;
    signal?: AbortSignal;
  }> = {},
): Promise<AdminContextRequestResult> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher("/api/admin/context", {
      cache: "no-store",
      credentials: "same-origin",
      headers: AJAX_JSON_HEADERS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return "failed";
  }

  if (
    response.status === 401 ||
    response.redirected ||
    !isJsonResponse(response)
  ) {
    return "access-login-required";
  }
  if (response.status !== 200) return "failed";

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return "failed";
  }
  return isLiveContext(body) ? "ready" : "failed";
}

export async function requestAdminActivity(
  fetcher: AdminApiFetch = fetch,
): Promise<AdminActivityRequestResult> {
  let response: Response;
  try {
    response = await fetcher("/api/admin/session/activity", {
      method: "POST",
      credentials: "same-origin",
      headers: AJAX_JSON_HEADERS,
    });
  } catch {
    return "lock-required";
  }

  if (!response.redirected && response.status === 204) {
    return "refreshed";
  }
  if (
    response.status === 401 ||
    response.redirected ||
    !isJsonResponse(response)
  ) {
    return "access-login-required";
  }
  return "lock-required";
}

export async function requestAdminLock(
  fetcher: AdminApiFetch = fetch,
): Promise<AdminLockRequestResult> {
  let response: Response;
  try {
    response = await fetcher("/api/admin/session/lock", {
      method: "POST",
      credentials: "same-origin",
      headers: AJAX_JSON_HEADERS,
      keepalive: true,
    });
  } catch {
    return { status: "locked" };
  }

  if (!response.redirected && response.status === 204) {
    return { status: "locked" };
  }
  if (
    response.status === 401 ||
    response.redirected ||
    !isJsonResponse(response)
  ) {
    return { status: "access-login-required" };
  }
  if (response.status !== 409) return { status: "locked" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "locked" };
  }
  const retryAfterMs = readRetryAfterMs(body);
  return retryAfterMs === null
    ? { status: "locked" }
    : { retryAfterMs, status: "retry" };
}
