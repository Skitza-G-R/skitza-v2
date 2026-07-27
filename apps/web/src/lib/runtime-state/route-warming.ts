import {
  isSameRuntimeMainNavigationCacheKey,
  type RuntimeNavigationSessionCache,
} from "./navigation-cache";
import type { RuntimeRole } from "./runtime-state";

export const RUNTIME_PREFETCH_COMPLETION_TIMEOUT_MS = 15_000;
export const RUNTIME_NAVIGATION_INTENT_MARK = "skitza:navigation:intent";
export const RUNTIME_NAVIGATION_COMMIT_MARK = "skitza:navigation:commit";
export const RUNTIME_NAVIGATION_COMMIT_MEASURE = "skitza:navigation:intent-to-commit";

type Cancel = () => void;

export type RuntimePrefetchCompletion =
  | "success"
  | "safari-compatible"
  | "http-failure"
  | "unverified"
  | "error"
  | "timeout";

export interface RuntimeObservedResourceTiming {
  name: string;
  responseStatusSupported: boolean;
  responseStatus?: number | undefined;
}

export interface RuntimeRouteWarmingOptions {
  cache: RuntimeNavigationSessionCache;
  currentHref: string;
  destinations: readonly string[];
  isActive: () => boolean;
  role: RuntimeRole;
  scheduleIdle: (callback: () => void) => Cancel;
  startPrefetch: (
    href: string,
    onComplete: (completion: RuntimePrefetchCompletion) => void,
  ) => Cancel;
  subscribeToActivity: (callback: () => void) => Cancel;
  warmCurrent?: boolean;
}

export interface RuntimeObservedRequestOptions {
  completionTimeoutMs?: number;
  href: string;
  onComplete: (completion: RuntimePrefetchCompletion) => void;
  origin: string;
  start: () => void;
  subscribeToResources?: (callback: (resource: RuntimeObservedResourceTiming) => void) => Cancel;
  timers?: {
    clearTimeout: (timeout: number) => void;
    setTimeout: (callback: () => void, delayMs: number) => number;
  };
}

export interface RuntimeIdleFallbackEnvironment {
  cancelAnimationFrame: (frame: number) => void;
  clearTimeout: (timeout: number) => void;
  isDocumentLoaded: () => boolean;
  requestAnimationFrame: (callback: () => void) => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
  subscribeToLoad: (callback: () => void) => Cancel;
}

function exactTransportFreeQuery(url: URL): string {
  const query = new URLSearchParams(url.search);
  query.delete("_rsc");
  query.sort();
  return query.toString();
}

/**
 * Next App Router RSC prefetches keep the destination pathname/query and add
 * the private `_rsc` transport parameter. A matching URL identifies the queue
 * position, while the response status proves whether it is safe to mark warm.
 *
 * Safari versions without `PerformanceResourceTiming.responseStatus` can only
 * prove that the exact RSC resource completed. That compatibility result marks
 * UX readiness only: Next still owns its payload/cache, and this code never
 * trusts or serves response data.
 */
export function runtimeResourceCompletionForHref(
  resourceTiming: RuntimeObservedResourceTiming,
  href: string,
  origin: string,
): RuntimePrefetchCompletion | null {
  try {
    const resource = new URL(resourceTiming.name, origin);
    const target = new URL(href, origin);
    const exactDestination =
      resource.origin === origin &&
      resource.pathname === target.pathname &&
      resource.searchParams.has("_rsc") &&
      exactTransportFreeQuery(resource) === exactTransportFreeQuery(target);
    if (!exactDestination) return null;

    if (!resourceTiming.responseStatusSupported) {
      return "safari-compatible";
    }

    const status = resourceTiming.responseStatus;
    if (typeof status !== "number" || !Number.isFinite(status) || status === 0) {
      return "unverified";
    }
    return status >= 200 && status < 300 ? "success" : "http-failure";
  } catch {
    return null;
  }
}

/**
 * `router.prefetch()` is fire-and-forget in Next 15.5. This adapter observes
 * the completed RSC resource before advancing. Browsers with status support
 * require a finite 2xx response. Safari without that property can emit the
 * separate UX-only compatibility result described above. HTTP failures,
 * unverified supported statuses, exceptions, and timeouts do not mark ready
 * and do not block later serial queue positions.
 */
export function startObservedRuntimeRequest({
  completionTimeoutMs = RUNTIME_PREFETCH_COMPLETION_TIMEOUT_MS,
  href,
  onComplete,
  origin,
  start,
  subscribeToResources,
  timers = {
    clearTimeout: (timeout) => {
      window.clearTimeout(timeout);
    },
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  },
}: RuntimeObservedRequestOptions): Cancel {
  let cancelled = false;
  let settled = false;
  let unsubscribeResources: Cancel = () => undefined;

  const finish = (completion: RuntimePrefetchCompletion) => {
    if (cancelled || settled) return;
    settled = true;
    timers.clearTimeout(completionTimeout);
    unsubscribeResources();
    onComplete(completion);
  };

  const completionTimeout = timers.setTimeout(() => {
    finish("timeout");
  }, completionTimeoutMs);

  let resourceSubscriptionFailed = false;
  if (subscribeToResources) {
    try {
      unsubscribeResources = subscribeToResources((resource) => {
        const completion = runtimeResourceCompletionForHref(resource, href, origin);
        if (completion) finish(completion);
      });
    } catch {
      resourceSubscriptionFailed = true;
      finish("error");
    }
  }

  if (!resourceSubscriptionFailed) {
    try {
      start();
    } catch {
      finish("error");
    }
  }

  return () => {
    if (cancelled) return;
    cancelled = true;
    timers.clearTimeout(completionTimeout);
    unsubscribeResources();
  };
}

/**
 * Safari has no requestIdleCallback. Wait for the cold document load, two
 * painted frames, and a short quiet window before competing for network/CPU.
 */
export function scheduleRuntimeIdleFallback(
  callback: () => void,
  environment: RuntimeIdleFallbackEnvironment,
  delayMs = 600,
): Cancel {
  let cancelled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let timeout = 0;
  let unsubscribeLoad: Cancel = () => undefined;

  const afterLoad = () => {
    if (cancelled) return;
    unsubscribeLoad();
    unsubscribeLoad = () => undefined;
    firstFrame = environment.requestAnimationFrame(() => {
      secondFrame = environment.requestAnimationFrame(() => {
        timeout = environment.setTimeout(callback, delayMs);
      });
    });
  };

  if (environment.isDocumentLoaded()) {
    afterLoad();
  } else {
    unsubscribeLoad = environment.subscribeToLoad(afterLoad);
  }

  return () => {
    if (cancelled) return;
    cancelled = true;
    unsubscribeLoad();
    environment.cancelAnimationFrame(firstFrame);
    environment.cancelAnimationFrame(secondFrame);
    environment.clearTimeout(timeout);
  };
}

/**
 * Starts at most one manual prefetch. The next destination is not even placed
 * in an idle slot until the prior completion adapter settles.
 */
export function startRuntimeRouteWarming({
  cache,
  currentHref,
  destinations,
  isActive,
  role,
  scheduleIdle,
  startPrefetch,
  subscribeToActivity,
  warmCurrent = false,
}: RuntimeRouteWarmingOptions): Cancel {
  const readyCandidates = destinations.filter((href) => !cache.isReady(href));
  const otherDestinations = readyCandidates.filter(
    (href) => !isSameRuntimeMainNavigationCacheKey(href, currentHref, role),
  );
  const currentDestinations = readyCandidates.filter((href) =>
    isSameRuntimeMainNavigationCacheKey(href, currentHref, role),
  );
  const queue = warmCurrent ? [...otherDestinations, ...currentDestinations] : otherDestinations;
  let cancelled = false;
  let index = 0;
  let cancelIdle: Cancel | null = null;
  let cancelPrefetch: Cancel | null = null;

  const pump = () => {
    if (cancelled || cancelIdle || cancelPrefetch || index >= queue.length || !isActive()) {
      return;
    }

    cancelIdle = scheduleIdle(() => {
      cancelIdle = null;
      if (cancelled || !isActive()) return;

      const href = queue[index];
      if (!href) return;
      const startup = { completedSynchronously: false };
      let starting = true;
      let completed = false;
      const complete = (completion: RuntimePrefetchCompletion) => {
        if (cancelled || completed) return;
        completed = true;
        if (starting) {
          startup.completedSynchronously = true;
        } else {
          cancelPrefetch = null;
        }
        if (completion === "success" || completion === "safari-compatible") {
          cache.markReady(href);
        }
        index += 1;
        pump();
      };

      let cancel: Cancel | null = null;
      try {
        cancel = startPrefetch(href, complete);
      } catch {
        complete("error");
      }
      starting = false;
      if (startup.completedSynchronously) {
        cancel?.();
      } else if (cancel) {
        cancelPrefetch = cancel;
      }
    });
  };

  const onActivity = () => {
    if (cancelled) return;
    if (!isActive()) {
      cancelIdle?.();
      cancelIdle = null;
      return;
    }
    pump();
  };
  const unsubscribeActivity = subscribeToActivity(onActivity);
  pump();

  return () => {
    if (cancelled) return;
    cancelled = true;
    cancelIdle?.();
    cancelPrefetch?.();
    unsubscribeActivity();
    cancelIdle = null;
    cancelPrefetch = null;
  };
}

export function markRuntimeNavigationIntent(
  timing: Pick<Performance, "clearMarks" | "clearMeasures" | "mark"> = performance,
): void {
  try {
    timing.clearMeasures(RUNTIME_NAVIGATION_COMMIT_MEASURE);
    timing.clearMarks(RUNTIME_NAVIGATION_INTENT_MARK);
    timing.clearMarks(RUNTIME_NAVIGATION_COMMIT_MARK);
    timing.mark(RUNTIME_NAVIGATION_INTENT_MARK);
  } catch {
    // Timing evidence is diagnostic and must never block navigation.
  }
}

export function markRuntimeNavigationCommit(
  timing: Pick<Performance, "mark" | "measure"> = performance,
): void {
  try {
    timing.mark(RUNTIME_NAVIGATION_COMMIT_MARK);
    timing.measure(
      RUNTIME_NAVIGATION_COMMIT_MEASURE,
      RUNTIME_NAVIGATION_INTENT_MARK,
      RUNTIME_NAVIGATION_COMMIT_MARK,
    );
  } catch {
    // A direct/programmatic navigation may not have an intent mark.
  }
}
