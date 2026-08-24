// SK-276 — shared eligibility + dismissal marker for the "turn on
// notifications" smart-moment banners. Mirrors the install-guidance
// discipline: bounded parsing, storage failures never break the host screen.

export const PUSH_INVITE_DISMISS_MS = 90 * 24 * 60 * 60 * 1000;

const DISMISSED_STORAGE_KEY = "skitza:push-invite-dismissed:v1";

export function parsePushInviteDismissedAt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function pushInviteEligible(
  input: Readonly<{
    supported: boolean;
    permission: NotificationPermission;
    subscribed: boolean;
    dismissedAt: number | null;
    now: number;
  }>,
): boolean {
  if (!input.supported || input.subscribed) return false;
  if (input.permission === "denied") return false;
  if (
    input.dismissedAt !== null &&
    Number.isFinite(input.dismissedAt) &&
    input.now - input.dismissedAt < PUSH_INVITE_DISMISS_MS
  ) {
    return false;
  }
  return true;
}

export function readPushInviteDismissedAt(): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return parsePushInviteDismissedAt(localStorage.getItem(DISMISSED_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function dismissPushInvite(now: number = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, String(now));
  } catch {
    // The invite is optional when browser storage is unavailable.
  }
}
