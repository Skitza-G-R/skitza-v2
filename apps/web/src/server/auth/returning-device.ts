import {
  joinSignUpHrefFromTarget,
  sanitizePostSignInTarget,
} from "./post-sign-in";

export const RETURNING_DEVICE_COOKIE = "skitza-returning";

const RETURNING_DEVICE_COOKIE_VALUE = "1";
const RETURNING_DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type ReturningDeviceState = Readonly<{
  userId: string | null | undefined;
  cookieValue: string | undefined;
}>;

type SignUpEntryState = ReturningDeviceState &
  Readonly<{
    intent: string | undefined;
    routeSegments: readonly string[] | undefined;
  }>;

export function returningDeviceCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    maxAge: RETURNING_DEVICE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax" as const,
    secure: isProduction,
  };
}

export function shouldStampReturningDeviceCookie({
  userId,
  cookieValue,
}: ReturningDeviceState): boolean {
  return Boolean(userId) && cookieValue !== RETURNING_DEVICE_COOKIE_VALUE;
}

export function shouldRedirectReturningDeviceToSignIn({
  userId,
  cookieValue,
  intent,
  routeSegments,
}: SignUpEntryState): boolean {
  return (
    !userId &&
    cookieValue === RETURNING_DEVICE_COOKIE_VALUE &&
    intent !== "signup" &&
    !routeSegments?.length
  );
}

export function signInSwitchHref(rawTarget?: string | null): string {
  const target = sanitizePostSignInTarget(rawTarget);
  // The homepage Producer CTA uses /onboarding as new-account intent. Do not
  // carry that generic target when a returning device is handed to sign-in.
  if (!target || target.href === "/onboarding") return "/sign-in";

  return `/sign-in?${new URLSearchParams({
    redirect_url: target.href,
  }).toString()}`;
}

export function invitationSignInHandoffHref(
  handoffToken: string,
  rawTarget?: string | null,
): string {
  const target = sanitizePostSignInTarget(rawTarget);
  const query = new URLSearchParams({
    invitation_complete: "1",
    invitation_handoff: handoffToken,
  });

  // Keep the same safe destination for the explicit sign-in that follows the
  // invitation handoff. `/onboarding` remains the default for a newly granted
  // Producer, so it does not need to be serialized into the URL.
  if (target && target.href !== "/onboarding") {
    query.set("redirect_url", target.href);
  }

  return `/sign-in?${query.toString()}`;
}

export function signUpSwitchHref(rawTarget?: string | null): string {
  const joinSignUpHref = joinSignUpHrefFromTarget(rawTarget);
  if (joinSignUpHref) return joinSignUpHref;

  const query = new URLSearchParams({ intent: "signup" });
  const target = sanitizePostSignInTarget(rawTarget);

  if (target) {
    query.set("redirect_url", target.href);
  }

  return `/sign-up?${query.toString()}`;
}
