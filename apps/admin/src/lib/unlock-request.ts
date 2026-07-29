export type AdminUnlockFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AdminUnlockResult =
  | Readonly<{ unlocked: true }>
  | Readonly<{
      accessLoginRequired: true;
      unlocked: false;
    }>
  | Readonly<{
      logoutPath: "/cdn-cgi/access/logout";
      reauthenticationRequired: true;
      unlocked: false;
    }>
  | Readonly<{
      failed: true;
      unlocked: false;
    }>;

export async function requestAdminUnlock(
  fetcher: AdminUnlockFetch = fetch,
): Promise<AdminUnlockResult> {
  const response = await fetcher("/api/admin/session/unlock", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (
    response.status === 401 ||
    response.redirected ||
    !contentType.toLowerCase().includes("application/json")
  ) {
    return { accessLoginRequired: true, unlocked: false };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { failed: true, unlocked: false };
  }

  if (
    response.ok &&
    typeof body === "object" &&
    body !== null &&
    Reflect.get(body, "unlocked") === true
  ) {
    return { unlocked: true };
  }

  if (
    response.status === 409 &&
    typeof body === "object" &&
    body !== null &&
    Reflect.get(body, "error") ===
      "cloudflare_reauthentication_required" &&
    Reflect.get(body, "logoutPath") === "/cdn-cgi/access/logout"
  ) {
    return {
      logoutPath: "/cdn-cgi/access/logout",
      reauthenticationRequired: true,
      unlocked: false,
    };
  }

  return { failed: true, unlocked: false };
}

export function isSuccessfulAdminUnlock(
  result: AdminUnlockResult,
): result is Readonly<{ unlocked: true }> {
  return result.unlocked;
}
