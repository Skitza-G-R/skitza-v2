import type { RuntimeRole } from "./runtime-state";

/**
 * Main-menu Links leave automatic viewport prefetching disabled. The runtime
 * shell owns an ordered queue instead, so a cold iPhone launch does not start
 * every authenticated RSC request together.
 */
export const RUNTIME_MAIN_NAVIGATION_LINK_PREFETCH = false as const;
export const RUNTIME_NAVIGATION_READY_MAX_AGE_MS = 150_000;
export const RUNTIME_MAIN_NAVIGATION_INTENT_EVENT = "skitza:runtime-main-navigation-intent";
export const RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE = "data-sk-nav-destination";
export const RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE = "data-sk-nav-pending";

export const PRODUCER_MAIN_NAVIGATION_DESTINATIONS = [
  "/dashboard",
  "/dashboard/clients-projects",
  "/dashboard/music",
  "/dashboard/calendar",
  "/dashboard/payments",
  "/dashboard/store",
  "/dashboard/portfolio",
  "/dashboard/settings",
] as const;

export const ARTIST_MAIN_NAVIGATION_DESTINATIONS = [
  "/artist",
  "/artist/music",
  "/artist/book",
  "/artist/store",
  "/artist/payments",
] as const;

const PRODUCER_MOBILE_CALENDAR_DESTINATION = "/dashboard/calendar?tab=sessions";
const RUNTIME_URL_ORIGIN = "https://runtime.skitza.invalid";

export interface RuntimeMainNavigationOptions {
  role: RuntimeRole;
  contextId: string;
  producerMobile?: boolean;
}

export interface RuntimeNavigationSessionCache {
  clear(): void;
  isReady(href: string): boolean;
  markReady(href: string): void;
}

export interface RuntimeNavigationSessionCacheOptions {
  maxAgeMs?: number;
  now?: () => number;
}

export interface RuntimeMainNavigationIntentDetail {
  href: string;
}

interface RuntimeMainNavigationTarget {
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

interface RuntimeMainNavigationTargetRoot {
  querySelectorAll(selectors: string): Iterable<RuntimeMainNavigationTarget>;
}

let capturedRuntimeMainNavigationTarget: RuntimeMainNavigationTarget | null = null;

function canonicalRelativeHref(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;

  try {
    const url = new URL(href, RUNTIME_URL_ORIGIN);
    const search = new URLSearchParams(url.search);
    search.sort();
    const query = search.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function artistDestination(href: string, contextId: string): string {
  if (!contextId || contextId === "artist-no-studio") return href;
  const search = new URLSearchParams({ studio: contextId });
  return `${href}?${search.toString()}`;
}

export function runtimeMainNavigationDestinations({
  role,
  contextId,
  producerMobile = false,
}: RuntimeMainNavigationOptions): readonly string[] {
  if (role === "artist") {
    return ARTIST_MAIN_NAVIGATION_DESTINATIONS.map((href) => artistDestination(href, contextId));
  }

  return PRODUCER_MAIN_NAVIGATION_DESTINATIONS.map((href) =>
    producerMobile && href === "/dashboard/calendar" ? PRODUCER_MOBILE_CALENDAR_DESTINATION : href,
  );
}

/**
 * Resolves only exact main-menu hrefs. This intentionally rejects deep links
 * and extra query state so an in-page control cannot accidentally opt into
 * shell navigation timing or background warming.
 */
export function resolveRuntimeMainNavigationHref(
  href: string,
  options: RuntimeMainNavigationOptions,
): string | null {
  const candidate = canonicalRelativeHref(href);
  if (!candidate) return null;

  const desktopDestinations = runtimeMainNavigationDestinations({
    ...options,
    producerMobile: false,
  });
  if (desktopDestinations.some((destination) => canonicalRelativeHref(destination) === candidate)) {
    return candidate;
  }

  if (options.role === "producer") {
    const mobileDestinations = runtimeMainNavigationDestinations({
      ...options,
      producerMobile: true,
    });
    if (
      mobileDestinations.some((destination) => canonicalRelativeHref(destination) === candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

export function runtimeMainDestinationPathname(href: string, role: RuntimeRole): string | null {
  const candidate = canonicalRelativeHref(href);
  if (!candidate) return null;

  const pathname = new URL(candidate, RUNTIME_URL_ORIGIN).pathname;
  const destinations =
    role === "producer"
      ? PRODUCER_MAIN_NAVIGATION_DESTINATIONS
      : ARTIST_MAIN_NAVIGATION_DESTINATIONS;
  return destinations.some((destination) => destination === pathname) ? pathname : null;
}

export function isSameRuntimeMainNavigationCacheKey(
  leftHref: string,
  rightHref: string,
  role: RuntimeRole,
): boolean {
  if (
    !runtimeMainDestinationPathname(leftHref, role) ||
    !runtimeMainDestinationPathname(rightHref, role)
  ) {
    return false;
  }
  return canonicalRelativeHref(leftHref) === canonicalRelativeHref(rightHref);
}

export function createRuntimeNavigationSessionCache({
  maxAgeMs = RUNTIME_NAVIGATION_READY_MAX_AGE_MS,
  now = Date.now,
}: RuntimeNavigationSessionCacheOptions = {}): RuntimeNavigationSessionCache {
  const readyHrefs = new Map<string, number>();

  return {
    clear() {
      readyHrefs.clear();
    },
    isReady(href) {
      const canonicalHref = canonicalRelativeHref(href);
      if (!canonicalHref) return false;
      const completedAt = readyHrefs.get(canonicalHref);
      if (completedAt === undefined) return false;
      if (now() - completedAt <= maxAgeMs) return true;
      readyHrefs.delete(canonicalHref);
      return false;
    },
    markReady(href) {
      const canonicalHref = canonicalRelativeHref(href);
      if (canonicalHref) readyHrefs.set(canonicalHref, now());
    },
  };
}

/**
 * Records the exact Link that initiated a click. Next calls the Link's
 * `onNavigate` only after it accepts the client navigation, so the target is
 * not made visually pending until `announceRuntimeMainNavigationIntent`.
 */
export function captureRuntimeMainNavigationTarget(target: EventTarget | null): void {
  const candidate = target as Partial<RuntimeMainNavigationTarget> | null;
  capturedRuntimeMainNavigationTarget =
    candidate &&
    typeof candidate.getAttribute === "function" &&
    typeof candidate.setAttribute === "function" &&
    typeof candidate.removeAttribute === "function" &&
    candidate.getAttribute(RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE)
      ? (candidate as RuntimeMainNavigationTarget)
      : null;
}

export function clearRuntimeMainNavigationPendingTargets(
  root?: RuntimeMainNavigationTargetRoot,
): void {
  capturedRuntimeMainNavigationTarget = null;
  const targetRoot =
    root ??
    (typeof document === "undefined"
      ? null
      : (document as unknown as RuntimeMainNavigationTargetRoot));
  if (!targetRoot) return;

  for (const target of targetRoot.querySelectorAll(
    `[${RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE}]`,
  )) {
    target.removeAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE);
    if (target.getAttribute("aria-busy") === "true") {
      target.removeAttribute("aria-busy");
    }
  }
}

/**
 * Called from Next Link's `onNavigate`. Unlike a document click listener this
 * runs only when Next accepted the client navigation.
 */
export function announceRuntimeMainNavigationIntent(href: string): void {
  if (typeof window === "undefined") return;
  const target = capturedRuntimeMainNavigationTarget;
  clearRuntimeMainNavigationPendingTargets();
  if (target?.getAttribute(RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE) === href) {
    target.setAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE, "");
    target.setAttribute("aria-busy", "true");
  }
  window.dispatchEvent(
    new CustomEvent<RuntimeMainNavigationIntentDetail>(RUNTIME_MAIN_NAVIGATION_INTENT_EVENT, {
      detail: { href },
    }),
  );
}
