export type AdminUnlockFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AdminUnlockResult =
  | Readonly<{ unlocked: true }>
  | Readonly<Record<string, unknown>>;

/**
 * Parses both successful responses and Clerk's 403 reverification hint.
 * useReverification inspects the returned JSON, opens its MFA flow when the
 * hint is present, and then retries this function.
 */
export async function requestAdminUnlock(
  fetcher: AdminUnlockFetch = fetch,
): Promise<AdminUnlockResult> {
  const response = await fetcher("/api/admin/session/unlock", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return (await response.json()) as AdminUnlockResult;
}

export function isSuccessfulAdminUnlock(
  result: AdminUnlockResult,
): result is Readonly<{ unlocked: true }> {
  return result.unlocked === true;
}
