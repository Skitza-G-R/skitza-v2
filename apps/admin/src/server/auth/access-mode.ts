// SK-274 — which infrastructure wall fronts the admin console.
//
// The original design requires a Cloudflare Access JWT on every request, but
// skitza.app's DNS is not on Cloudflare yet, so that wall cannot exist today.
// The founder approved an explicit fallback mode for the beta window:
// Vercel Deployment Protection (team-only reachability) + Clerk sign-in with
// MFA + the founder-role metadata gate + a hard founder-user-id pin. The
// Cloudflare path stays the default and is untouched; unknown mode values
// fail closed.

export const ADMIN_ACCESS_MODE_ENV = "ADMIN_ACCESS_MODE";
export const ADMIN_FOUNDER_CLERK_USER_ID_ENV = "ADMIN_FOUNDER_CLERK_USER_ID";

export type AdminAccessMode = "cloudflare-access" | "vercel-protection";

const FOUNDER_CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]{8,64}$/;

export class AdminAccessModeError extends Error {
  constructor() {
    super("The admin access mode configuration is invalid.");
    this.name = "AdminAccessModeError";
  }
}

export type AdminAccessModeEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveAdminAccessMode(
  environment: AdminAccessModeEnvironment = process.env,
): AdminAccessMode {
  const raw = environment[ADMIN_ACCESS_MODE_ENV]?.trim();
  if (!raw || raw === "cloudflare-access") return "cloudflare-access";
  if (raw === "vercel-protection") return "vercel-protection";
  throw new AdminAccessModeError();
}

/**
 * The one Clerk user id allowed through in vercel-protection mode. Required
 * (and validated) whenever that mode is active — a missing or malformed pin
 * is a configuration error, never an open door.
 */
export function requiredFounderClerkUserId(
  environment: AdminAccessModeEnvironment = process.env,
): string {
  const value = environment[ADMIN_FOUNDER_CLERK_USER_ID_ENV]?.trim();
  if (!value || !FOUNDER_CLERK_USER_ID_PATTERN.test(value)) {
    throw new AdminAccessModeError();
  }
  return value;
}
