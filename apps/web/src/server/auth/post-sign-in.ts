import type { UserAccountMemberships } from "./role";

export type AuthPlatform = "artist" | "producer";

export type SanitizedPostSignInTarget = Readonly<{
  href: string;
  platform: AuthPlatform;
}>;

const AUTH_TARGET_ORIGIN = "https://post-sign-in.skitza.invalid";
const MAX_AUTH_TARGET_LENGTH = 2048;

function matchesRouteFamily(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

function platformForPathname(pathname: string): AuthPlatform | null {
  if (
    matchesRouteFamily(pathname, "/artist") ||
    matchesRouteFamily(pathname, "/artist-welcome")
  ) {
    return "artist";
  }
  if (
    matchesRouteFamily(pathname, "/dashboard") ||
    matchesRouteFamily(pathname, "/onboarding") ||
    matchesRouteFamily(pathname, "/projects") ||
    matchesRouteFamily(pathname, "/settings")
  ) {
    return "producer";
  }
  return null;
}

/**
 * Accept only a bounded, same-origin route in one of the protected Skitza app
 * families. This helper is deliberately separate from normalizeRuntimeHref:
 * runtime-state restoration excludes live transactional artist routes and
 * strips query keys, while post-sign-in must preserve the original deep link.
 */
export function sanitizePostSignInTarget(
  rawTarget: string | null | undefined,
): SanitizedPostSignInTarget | null {
  if (
    !rawTarget ||
    rawTarget.length > MAX_AUTH_TARGET_LENGTH ||
    !rawTarget.startsWith("/")
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawTarget, AUTH_TARGET_ORIGIN);
  } catch {
    return null;
  }

  if (
    url.origin !== AUTH_TARGET_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return null;
  }

  const platform = platformForPathname(url.pathname);
  if (!platform) return null;
  return {
    href: `${url.pathname}${url.search}`,
    platform,
  };
}

function hrefWithNestedTarget(
  pathname: "/auth/resolve" | "/choose-role",
  rawTarget: string | null | undefined,
): string {
  const target = sanitizePostSignInTarget(rawTarget);
  if (!target) return pathname;
  const query = new URLSearchParams({ next: target.href });
  return `${pathname}?${query.toString()}`;
}

export function postSignInResolverHref(
  rawTarget?: string | null,
): string {
  return hrefWithNestedTarget("/auth/resolve", rawTarget);
}

export function roleChooserHref(rawTarget?: string | null): string {
  return hrefWithNestedTarget("/choose-role", rawTarget);
}

function isProducerAccount(
  memberships: UserAccountMemberships,
): boolean {
  return (
    memberships.primaryRole.kind === "producer-complete" ||
    memberships.primaryRole.kind === "producer-incomplete"
  );
}

export function isGenuineDualRoleAccount(
  memberships: UserAccountMemberships,
): boolean {
  return isProducerAccount(memberships) && memberships.hasArtistAccount;
}

function signInHref(rawTarget?: string | null): string {
  const target = sanitizePostSignInTarget(rawTarget);
  if (!target) return "/sign-in";
  return `/sign-in?${new URLSearchParams({
    redirect_url: target.href,
  }).toString()}`;
}

/**
 * Resolve the first authenticated destination. Explicit deep links are kept
 * only for the platform the account can enter. A genuine dual account always
 * gets the role choice requested by SK-152, with the target carried forward.
 */
export function postSignInDestination(
  memberships: UserAccountMemberships,
  rawTarget?: string | null,
): string {
  const target = sanitizePostSignInTarget(rawTarget);

  if (memberships.primaryRole.kind === "unauthenticated") {
    return signInHref(target?.href);
  }

  if (isGenuineDualRoleAccount(memberships)) {
    return roleChooserHref(target?.href);
  }

  if (isProducerAccount(memberships)) {
    if (memberships.primaryRole.kind === "producer-incomplete") {
      return "/onboarding";
    }
    return target?.platform === "producer" ? target.href : "/dashboard";
  }

  if (memberships.hasArtistAccount) {
    return target?.platform === "artist" ? target.href : "/artist";
  }

  return "/onboarding";
}

/**
 * Resolve one of the two explicit choices after rechecking the account's
 * memberships. A manipulated choice cannot grant another platform: unavailable
 * roles fall back through the normal single-role resolver.
 */
export function chosenRoleDestination(
  memberships: UserAccountMemberships,
  chosenRole: AuthPlatform,
  rawTarget?: string | null,
): string {
  const target = sanitizePostSignInTarget(rawTarget);

  if (
    chosenRole === "artist" &&
    memberships.hasArtistAccount &&
    memberships.primaryRole.kind !== "unauthenticated"
  ) {
    return target?.platform === "artist" ? target.href : "/artist";
  }

  if (chosenRole === "producer" && isProducerAccount(memberships)) {
    if (memberships.primaryRole.kind === "producer-incomplete") {
      return "/onboarding";
    }
    return target?.platform === "producer" ? target.href : "/dashboard";
  }

  return postSignInDestination(memberships, target?.href);
}
