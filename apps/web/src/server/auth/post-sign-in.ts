import type { UserAccountMemberships } from "./role";
import type { JoinContinuationAction } from "./join-intent";

export type AuthPlatform = "artist" | "producer";

export type SanitizedPostSignInTarget = Readonly<{
  href: string;
  platform: AuthPlatform;
}>;

const AUTH_TARGET_ORIGIN = "https://post-sign-in.skitza.invalid";
const MAX_AUTH_TARGET_LENGTH = 2048;
const JOIN_SLUG_PATTERN = /^[a-z0-9-]{3,48}$/;

function matchesRouteFamily(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

function isJoinContinuationUrl(url: URL): boolean {
  const match = /^\/join\/([^/]+)\/continue$/.exec(url.pathname);
  if (!match || !JOIN_SLUG_PATTERN.test(match[1] ?? "")) return false;
  const entries = Array.from(url.searchParams.entries());
  if (entries.length !== 1) return false;
  return (
    entries[0]?.[0] === "action" &&
    (entries[0][1] === "book" ||
      entries[0][1] === "unlock" ||
      entries[0][1] === "home" ||
      entries[0][1] === "store")
  );
}

function isPublicSongUrl(url: URL): boolean {
  return /^\/listen\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(url.pathname) && url.search.length === 0;
}

function platformForUrl(url: URL): AuthPlatform | null {
  const { pathname } = url;
  if (isPublicSongUrl(url)) return "artist";
  if (isJoinContinuationUrl(url)) return "artist";
  if (matchesRouteFamily(pathname, "/artist") || matchesRouteFamily(pathname, "/artist-welcome")) {
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
  if (!rawTarget || rawTarget.length > MAX_AUTH_TARGET_LENGTH || !rawTarget.startsWith("/")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawTarget, AUTH_TARGET_ORIGIN);
  } catch {
    return null;
  }

  if (url.origin !== AUTH_TARGET_ORIGIN || url.username || url.password || url.hash) {
    return null;
  }

  const platform = platformForUrl(url);
  if (!platform) return null;
  return {
    href: `${url.pathname}${url.search}`,
    platform,
  };
}

export function joinContinuationHref(
  slug: string,
  action: JoinContinuationAction = "book",
): string {
  if (!JOIN_SLUG_PATTERN.test(slug)) return "/";
  return `/join/${slug}/continue?action=${action}`;
}

export function joinSignInHref(slug: string, action: JoinContinuationAction = "book"): string {
  const continuationHref = joinContinuationHref(slug, action);
  if (continuationHref === "/") return "/sign-in";
  return `/sign-in?${new URLSearchParams({
    redirect_url: continuationHref,
  }).toString()}`;
}

export function joinSignUpHrefFromTarget(rawTarget: string | null | undefined): string | null {
  const target = sanitizePostSignInTarget(rawTarget);
  if (!isJoinIntentTarget(target)) return null;
  const url = new URL(target?.href ?? "/", AUTH_TARGET_ORIGIN);
  const match = /^\/join\/([^/]+)\/continue$/.exec(url.pathname);
  const action = url.searchParams.get("action");
  return match?.[1]
    ? `/sign-up/join/${encodeURIComponent(match[1])}${
        action === "book"
          ? "/book"
          : action === "unlock"
            ? "/unlock"
            : action === "home" || action === "store"
              ? "/home"
              : ""
      }?intent=signup`
    : null;
}

export function isJoinIntentTarget(target: SanitizedPostSignInTarget | null): boolean {
  if (!target) return false;
  return isJoinContinuationUrl(new URL(target.href, AUTH_TARGET_ORIGIN));
}

export function joinSignUpMetadataFromTarget(
  rawTarget: string | null | undefined,
): Readonly<{ signupOrigin: "join"; producerSlug: string }> | null {
  const target = sanitizePostSignInTarget(rawTarget);
  if (!isJoinIntentTarget(target)) return null;

  const url = new URL(target?.href ?? "/", AUTH_TARGET_ORIGIN);
  const match = /^\/join\/([^/]+)\/continue$/.exec(url.pathname);
  const producerSlug = match?.[1];
  return producerSlug ? { signupOrigin: "join", producerSlug } : null;
}

export function trustedAuthRequestOrigin(input: {
  forwardedHost: string | null | undefined;
  forwardedProto: string | null | undefined;
  host: string | null | undefined;
}): string | null {
  const host = (input.forwardedHost ?? input.host)?.split(",")[0]?.trim();
  const proto = input.forwardedProto?.split(",")[0]?.trim() ?? "https";
  if (
    !host ||
    host.length > 253 ||
    !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host) ||
    (proto !== "http" && proto !== "https")
  ) {
    return null;
  }
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

export function normalizeSameOriginPostSignInTarget(
  rawTarget: string | null | undefined,
  requestOrigin: string | null,
): string | null {
  if (!rawTarget || rawTarget.length > 1024) return null;
  if (rawTarget.startsWith("/") && !rawTarget.startsWith("//")) {
    return rawTarget;
  }
  if (!requestOrigin) return null;
  try {
    const target = new URL(rawTarget);
    if (target.origin !== requestOrigin || target.username || target.password || target.hash) {
      return null;
    }
    return `${target.pathname}${target.search}`;
  } catch {
    return null;
  }
}

function isGenericProducerSignUpTarget(target: SanitizedPostSignInTarget | null): boolean {
  return target?.href === "/onboarding";
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

function normalizeLegacyStoreTarget(
  target: SanitizedPostSignInTarget | null,
): SanitizedPostSignInTarget | null {
  if (!target) return null;
  const url = new URL(target.href, AUTH_TARGET_ORIGIN);
  if (!isJoinContinuationUrl(url) || url.searchParams.get("action") !== "store") {
    return target;
  }
  url.searchParams.set("action", "home");
  return {
    href: `${url.pathname}${url.search}`,
    platform: target.platform,
  };
}

export function postSignInResolverHref(rawTarget?: string | null): string {
  const target = normalizeLegacyStoreTarget(sanitizePostSignInTarget(rawTarget));
  // `/onboarding` is the generic landing-page signup destination, not an
  // explicit request from a returning account. Dropping it here lets the
  // membership resolver choose the account's real platform and still sends
  // incomplete Producers back to onboarding.
  if (isGenericProducerSignUpTarget(target)) return "/auth/resolve";
  return hrefWithNestedTarget("/auth/resolve", target?.href);
}

/**
 * Clerk exposes separate post-sign-in and post-sign-up destinations. Keep the
 * same validated target for both so a normal Producer invite reaches Artist
 * Home whether the Artist signs in or creates their account. The continuation
 * route revalidates the Producer before any connection write.
 */
export function postSignUpResolverHref(rawTarget?: string | null): string {
  const target = normalizeLegacyStoreTarget(sanitizePostSignInTarget(rawTarget));
  if (!target) return "/auth/resolve";
  return hrefWithNestedTarget("/auth/resolve", target.href);
}

export function roleChooserHref(rawTarget?: string | null): string {
  return hrefWithNestedTarget("/choose-role", rawTarget);
}

export function roleSwitchHref(role: AuthPlatform, rawTarget?: string | null): string {
  const target = sanitizePostSignInTarget(rawTarget);
  const query = new URLSearchParams({ role });
  if (target?.platform === role) query.set("next", target.href);
  return `/auth/switch?${query.toString()}`;
}

function isProducerAccount(memberships: UserAccountMemberships): boolean {
  return memberships.producer.status !== "none";
}

export function isGenuineDualRoleAccount(memberships: UserAccountMemberships): boolean {
  return isProducerAccount(memberships) && memberships.artist.hasAccess;
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
 * only for the platform the account can enter. Generic dual-role entry resumes
 * the most recently used role and uses the chooser only when no role is saved.
 */
export function postSignInDestination(
  memberships: UserAccountMemberships,
  rawTarget?: string | null,
): string {
  const sanitizedTarget = sanitizePostSignInTarget(rawTarget);
  const target = isGenericProducerSignUpTarget(sanitizedTarget) ? null : sanitizedTarget;

  if (!memberships.isAuthenticated) {
    return signInHref(target?.href);
  }

  // A guest Song link remains a guest Song link after authentication. The
  // page itself redirects only the exact Artist or Producer owner into their
  // full app; every unrelated signed-in account keeps the same listening URL.
  if (target && isPublicSongUrl(new URL(target.href, AUTH_TARGET_ORIGIN))) {
    return target.href;
  }

  // A join continuation is an Artist-intent hand-off, not an authorization
  // grant. Every authenticated account may reach that route; it re-resolves
  // the producer, blocks self-joins, asks Producer accounts for confirmation,
  // and performs the verified-email connection server-side.
  if (isJoinIntentTarget(target)) {
    return target?.href ?? "/";
  }

  // Role-specific links win over the remembered role for a dual account.
  // The protected destination still rechecks the real DB membership.
  if (target?.platform === "artist" && memberships.artist.hasAccess) {
    return target.href;
  }
  if (target?.platform === "producer" && isProducerAccount(memberships)) {
    return memberships.producer.status === "incomplete" ? "/onboarding" : target.href;
  }

  if (isGenuineDualRoleAccount(memberships)) {
    return "/auth/resume";
  }

  if (isProducerAccount(memberships)) {
    if (memberships.producer.status === "incomplete") {
      return "/onboarding";
    }
    return target?.platform === "producer" ? target.href : "/dashboard";
  }

  if (memberships.artist.hasAccess) {
    return target?.platform === "artist" ? target.href : "/artist";
  }

  return "/producer-access";
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

  if (chosenRole === "artist" && memberships.artist.hasAccess && memberships.isAuthenticated) {
    return target?.platform === "artist" ? target.href : "/artist";
  }

  if (chosenRole === "producer" && isProducerAccount(memberships)) {
    if (memberships.producer.status === "incomplete") {
      return "/onboarding";
    }
    return target?.platform === "producer" ? target.href : "/dashboard";
  }

  return postSignInDestination(memberships, target?.href);
}
