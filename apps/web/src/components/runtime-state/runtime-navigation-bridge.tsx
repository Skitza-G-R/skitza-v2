"use client";

import { useLayoutEffect, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  popRuntimeBack,
  readRuntimeNavigationSnapshot,
  readRuntimeResumeHref,
  recordRuntimeNavigation,
  type RuntimeIdentity,
} from "~/lib/runtime-state/navigation";
import {
  captureAccountPrivateWriteGeneration,
  isAccountPrivateRuntimeWriteAllowed,
} from "~/lib/runtime-state/account-exit";
import {
  clearRuntimeMainNavigationPendingTargets,
  createRuntimeNavigationSessionCache,
  resolveRuntimeMainNavigationHref,
  RUNTIME_MAIN_NAVIGATION_INTENT_EVENT,
  runtimeMainDestinationPathname,
  runtimeMainNavigationDestinations,
  type RuntimeMainNavigationIntentDetail,
} from "~/lib/runtime-state/navigation-cache";
import {
  markRuntimeNavigationCommit,
  markRuntimeNavigationIntent,
  scheduleRuntimeIdleFallback,
  startObservedRuntimeRequest,
  startRuntimeRouteWarming,
  type RuntimeObservedResourceTiming,
} from "~/lib/runtime-state/route-warming";
import {
  normalizeRuntimeHref,
  readRuntimeLaunchTargetForRole,
  runtimeLaunchHrefForCurrentContext,
  writeRuntimeLaunchPointer,
} from "~/lib/runtime-state/runtime-state";
import { NATIVE_REFRESH_EVENT } from "~/lib/pwa/update-coordination";

import { useRuntimeState } from "./runtime-state-provider";

function runtimeScrollTarget(): HTMLElement | Window {
  const main = document.getElementById("main-content");
  if (main) {
    const overflowY = window.getComputedStyle(main).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return main;
  }
  return window;
}

function currentScrollTop(): number {
  const target = runtimeScrollTarget();
  return target instanceof HTMLElement ? target.scrollTop : window.scrollY;
}

function restoreScrollTop(scrollTop: number): () => void {
  let cancelled = false;
  let frame = 0;
  let frameAttempts = 0;
  let observer: ResizeObserver | null = null;
  let timeout = 0;

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    window.cancelAnimationFrame(frame);
    observer?.disconnect();
    window.clearTimeout(timeout);
  };

  const apply = () => {
    if (cancelled) return;
    const target = runtimeScrollTarget();
    if (target instanceof HTMLElement) {
      target.scrollTo({ top: scrollTop, behavior: "auto" });
    } else {
      window.scrollTo({ top: scrollTop, behavior: "auto" });
    }

    const actual = target instanceof HTMLElement ? target.scrollTop : window.scrollY;
    if (Math.abs(actual - scrollTop) <= 1) {
      stop();
      return;
    }
    if (frameAttempts < 12) {
      frameAttempts += 1;
      frame = window.requestAnimationFrame(apply);
    }
  };

  timeout = window.setTimeout(stop, 4_000);
  const main = document.getElementById("main-content");
  if (main && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => {
      apply();
    });
    observer.observe(main);
  }
  frame = window.requestAnimationFrame(apply);
  return stop;
}

function subscribeToScroll(onScroll: () => void): () => void {
  const target = runtimeScrollTarget();
  target.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    target.removeEventListener("scroll", onScroll);
  };
}

function toNavigationIdentity(
  identity: ReturnType<typeof useRuntimeState>["identity"],
): RuntimeIdentity {
  return {
    userId: identity.userId,
    role: identity.role,
    contextId: identity.contextId,
  };
}

interface PendingRuntimeNavigation {
  href: string;
  originHref: string;
  timeout: number;
  warm: boolean;
}

let runtimePageActive = true;

function isProducerMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

function isRuntimeWarmingActive(): boolean {
  return runtimePageActive && navigator.onLine && document.visibilityState !== "hidden";
}

function scheduleRuntimeIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const idle = window.requestIdleCallback(callback, { timeout: 2_000 });
    return () => {
      window.cancelIdleCallback(idle);
    };
  }

  return scheduleRuntimeIdleFallback(callback, {
    isDocumentLoaded: () => document.readyState === "complete",
    subscribeToLoad: (onLoad) => {
      window.addEventListener("load", onLoad, { once: true });
      return () => {
        window.removeEventListener("load", onLoad);
      };
    },
    requestAnimationFrame: (onFrame) => window.requestAnimationFrame(onFrame),
    cancelAnimationFrame: (frame) => {
      window.cancelAnimationFrame(frame);
    },
    setTimeout: (onTimeout, delayMs) => window.setTimeout(onTimeout, delayMs),
    clearTimeout: (timeout) => {
      window.clearTimeout(timeout);
    },
  });
}

function subscribeToRuntimeActivity(callback: () => void): () => void {
  const onPageHide = () => {
    runtimePageActive = false;
    callback();
  };
  const onPageShow = () => {
    runtimePageActive = true;
    callback();
  };
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", callback);
  };
}

function subscribeToRuntimeResources(
  callback: (resource: RuntimeObservedResourceTiming) => void,
): () => void {
  if (typeof PerformanceObserver === "undefined") return () => undefined;

  const observer = new PerformanceObserver((entries) => {
    for (const entry of entries.getEntries()) {
      const resource = entry as PerformanceResourceTiming;
      callback({
        name: resource.name,
        responseStatus: resource.responseStatus,
        responseStatusSupported: "responseStatus" in resource,
      });
    }
  });
  try {
    observer.observe({ type: "resource" });
  } catch {
    try {
      observer.observe({ entryTypes: ["resource"] });
    } catch {
      observer.disconnect();
      return () => undefined;
    }
  }
  return () => {
    observer.disconnect();
  };
}

function clearNavigationElementState(root: HTMLElement): void {
  delete root.dataset.skNavSource;
  delete root.dataset.skNavState;
  clearRuntimeMainNavigationPendingTargets(root);
}

export function afterRuntimeNavigationPaint(callback: () => void): () => void {
  let secondFrame = 0;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(callback);
  });
  return () => {
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
  };
}

/**
 * Shell-level adapter. Mount once inside RuntimeStateProvider for each signed-in
 * role shell. It stores only safe route/filter/scroll metadata.
 */
export function RuntimeNavigationBridge({
  cacheEpoch = "mount",
  restoreOnOpen = true,
}: {
  cacheEpoch?: number | string;
  restoreOnOpen?: boolean;
}) {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const openedForIdentity = useRef<string | null>(null);
  const skipPersistHref = useRef<string | null>(null);
  const pendingNavigation = useRef<PendingRuntimeNavigation | null>(null);
  const currentHrefRef = useRef("");
  const initialCacheEpoch = useRef(cacheEpoch);
  const warmSourcePathname = useRef<string | null>(null);
  const privateStateAccessAllowedRef = useRef(privateStateAccessAllowed);
  const navigationIdentity = useMemo(
    () => toNavigationIdentity(identity),
    [identity.contextId, identity.role, identity.userId],
  );
  const search = searchParams.toString();
  const preserveRequestedRoot = searchParams.get("storeTip") === "1";
  const href = `${pathname}${search ? `?${search}` : ""}`;
  const safeHref = normalizeRuntimeHref(href, identity.role);
  const launchHref = runtimeLaunchHrefForCurrentContext(
    navigationIdentity,
    href,
  );
  const identityKey = `${identity.userId}:${identity.role}:${identity.contextId}`;
  const navigationCache = useMemo(
    () => createRuntimeNavigationSessionCache(),
    [cacheEpoch, identityKey],
  );
  currentHrefRef.current = href;
  privateStateAccessAllowedRef.current = privateStateAccessAllowed;

  useLayoutEffect(() => {
    if (!privateStateAccessAllowed || !storage || !safeHref) return;

    if (restoreOnOpen && openedForIdentity.current !== identityKey) {
      openedForIdentity.current = identityKey;
      if (!preserveRequestedRoot) {
        const root = identity.role === "producer" ? "/dashboard" : "/artist";
        const resumeHref = readRuntimeResumeHref(storage, navigationIdentity);
        if (safeHref === root && resumeHref && resumeHref !== root) {
          skipPersistHref.current = safeHref;
          router.replace(resumeHref);
          return;
        }
      }
    }

    const snapshot = readRuntimeNavigationSnapshot(storage, navigationIdentity, safeHref);
    return snapshot ? restoreScrollTop(snapshot.scrollTop) : undefined;
  }, [
    identity.role,
    identityKey,
    navigationIdentity,
    privateStateAccessAllowed,
    preserveRequestedRoot,
    restoreOnOpen,
    router,
    safeHref,
    storage,
  ]);

  useEffect(() => {
    if (
      !privateStateAccessAllowed ||
      !storage ||
      safeHref ||
      !launchHref
    ) {
      return;
    }
    const writeGeneration = captureAccountPrivateWriteGeneration(identity.userId);
    const touchRoleLaunch = () => {
      if (!isAccountPrivateRuntimeWriteAllowed(writeGeneration)) return;
      const existingLaunch = readRuntimeLaunchTargetForRole(
        storage,
        identity.userId,
        identity.role,
      );
      const preferredHref =
        existingLaunch?.contextId === identity.contextId
          ? existingLaunch.href
          : launchHref;
      if (
        !writeRuntimeLaunchPointer(storage, navigationIdentity, preferredHref) &&
        preferredHref !== launchHref
      ) {
        writeRuntimeLaunchPointer(storage, navigationIdentity, launchHref);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") touchRoleLaunch();
    };

    touchRoleLaunch();
    window.addEventListener("pagehide", touchRoleLaunch);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      touchRoleLaunch();
      window.removeEventListener("pagehide", touchRoleLaunch);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    identity.contextId,
    identity.role,
    identity.userId,
    launchHref,
    navigationIdentity,
    privateStateAccessAllowed,
    safeHref,
    storage,
  ]);

  useEffect(() => {
    if (!privateStateAccessAllowed || !storage || !safeHref) return;
    if (skipPersistHref.current === safeHref) return;
    skipPersistHref.current = null;

    const writeGeneration = captureAccountPrivateWriteGeneration(identity.userId);
    const existingSnapshot = readRuntimeNavigationSnapshot(storage, navigationIdentity, safeHref);
    let latestScrollTop = existingSnapshot?.scrollTop ?? currentScrollTop();

    let frame = 0;
    const persist = () => {
      if (!isAccountPrivateRuntimeWriteAllowed(writeGeneration)) return;
      if (recordRuntimeNavigation(storage, navigationIdentity, safeHref, latestScrollTop)) {
        if (launchHref) {
          writeRuntimeLaunchPointer(storage, navigationIdentity, launchHref);
        }
      }
    };
    persist();
    const captureCurrentScrollTop = () => {
      latestScrollTop = currentScrollTop();
    };
    const onScroll = () => {
      captureCurrentScrollTop();
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(persist);
    };
    const onPageHide = () => {
      captureCurrentScrollTop();
      persist();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        captureCurrentScrollTop();
        persist();
      }
    };

    const unsubscribeScroll = subscribeToScroll(onScroll);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.cancelAnimationFrame(frame);
      persist();
      unsubscribeScroll();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    identity.userId,
    launchHref,
    navigationIdentity,
    privateStateAccessAllowed,
    safeHref,
    storage,
  ]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const options = {
      role: identity.role,
      contextId: identity.contextId,
    };
    const currentMainHref = resolveRuntimeMainNavigationHref(href, options);
    const currentPathname = runtimeMainDestinationPathname(href, identity.role);

    const pending = pendingNavigation.current;
    if (pending && currentMainHref === pending.href) {
      return afterRuntimeNavigationPaint(() => {
        if (pendingNavigation.current !== pending) return;
        window.clearTimeout(pending.timeout);
        pendingNavigation.current = null;
        root.dataset.skNavState = "settled";
        clearRuntimeMainNavigationPendingTargets();
        markRuntimeNavigationCommit();
        navigationCache.markReady(currentMainHref);

        if (pending.warm) {
          root.dataset.skNavSource = "warm";
          warmSourcePathname.current = currentPathname;
        } else {
          delete root.dataset.skNavSource;
          warmSourcePathname.current = null;
        }
      });
    }

    if (pending && href !== pending.originHref) {
      return afterRuntimeNavigationPaint(() => {
        if (pendingNavigation.current !== pending) return;
        window.clearTimeout(pending.timeout);
        pendingNavigation.current = null;
        root.dataset.skNavState = "settled";
        clearRuntimeMainNavigationPendingTargets();
        delete root.dataset.skNavSource;
        warmSourcePathname.current = null;
      });
    }

    if (root.dataset.skNavSource === "warm" && currentPathname !== warmSourcePathname.current) {
      delete root.dataset.skNavSource;
      warmSourcePathname.current = null;
    }
  }, [href, identity.contextId, identity.role, navigationCache]);

  useLayoutEffect(() => {
    const onNavigationIntent = (event: Event) => {
      const detail = (event as CustomEvent<Partial<RuntimeMainNavigationIntentDetail> | undefined>)
        .detail;
      if (!detail || typeof detail.href !== "string") return;
      const targetHref = resolveRuntimeMainNavigationHref(detail.href, {
        role: identity.role,
        contextId: identity.contextId,
      });
      const previous = pendingNavigation.current;
      if (previous) {
        window.clearTimeout(previous.timeout);
        pendingNavigation.current = null;
      }

      const root = document.documentElement;
      if (!targetHref || targetHref === currentHrefRef.current) {
        clearNavigationElementState(root);
        warmSourcePathname.current = null;
        return;
      }

      const warm =
        privateStateAccessAllowedRef.current && navigationCache.isReady(targetHref);
      detail.warm = warm;
      root.dataset.skNavState = "pending";
      if (warm) {
        root.dataset.skNavSource = "warm";
        warmSourcePathname.current = runtimeMainDestinationPathname(targetHref, identity.role);
      } else {
        delete root.dataset.skNavSource;
        warmSourcePathname.current = null;
      }
      markRuntimeNavigationIntent();

      const pending: PendingRuntimeNavigation = {
        href: targetHref,
        originHref: currentHrefRef.current,
        timeout: 0,
        warm,
      };
      pending.timeout = window.setTimeout(() => {
        if (pendingNavigation.current !== pending) return;
        pendingNavigation.current = null;
        root.dataset.skNavState = "settled";
        clearRuntimeMainNavigationPendingTargets();
        delete root.dataset.skNavSource;
        warmSourcePathname.current = null;
      }, 10_000);
      pendingNavigation.current = pending;
    };

    window.addEventListener(RUNTIME_MAIN_NAVIGATION_INTENT_EVENT, onNavigationIntent);
    return () => {
      window.removeEventListener(RUNTIME_MAIN_NAVIGATION_INTENT_EVENT, onNavigationIntent);
      clearRuntimeMainNavigationPendingTargets();
    };
  }, [identity.contextId, identity.role, navigationCache]);

  useEffect(() => {
    if (!privateStateAccessAllowed) return;

    const onNativeFreshnessCheck = () => {
      if (!isRuntimeWarmingActive()) return;
      const currentSafeHref = normalizeRuntimeHref(
        currentHrefRef.current,
        identity.role,
      );
      if (
        currentSafeHref &&
        runtimeMainDestinationPathname(currentSafeHref, identity.role)
      ) {
        router.prefetch(currentSafeHref);
      }
    };

    window.addEventListener(NATIVE_REFRESH_EVENT, onNativeFreshnessCheck);
    return () => {
      window.removeEventListener(
        NATIVE_REFRESH_EVENT,
        onNativeFreshnessCheck,
      );
    };
  }, [
    identity.contextId,
    identity.role,
    privateStateAccessAllowed,
    router,
  ]);

  useEffect(() => {
    if (!privateStateAccessAllowed) return;

    const destinations = runtimeMainNavigationDestinations({
      role: identity.role,
      contextId: identity.contextId,
      producerMobile: identity.role === "producer" && isProducerMobileViewport(),
    });
    return startRuntimeRouteWarming({
      cache: navigationCache,
      currentHref: currentHrefRef.current,
      destinations,
      role: identity.role,
      isActive: isRuntimeWarmingActive,
      scheduleIdle: scheduleRuntimeIdle,
      subscribeToActivity: subscribeToRuntimeActivity,
      // Next seeds the cold-launch current route as an AUTO entry that its
      // public prefetch API cannot upgrade. A later authoritative server-shell
      // replacement changes the cache epoch; from then on the current route
      // can be safely warmed, last, like every other destination.
      warmCurrent: cacheEpoch !== initialCacheEpoch.current,
      startPrefetch: (destination, onComplete) =>
        startObservedRuntimeRequest({
          href: destination,
          origin: window.location.origin,
          onComplete,
          start: () => {
            router.prefetch(destination);
          },
          subscribeToResources: subscribeToRuntimeResources,
        }),
    });
  }, [
    cacheEpoch,
    identity.contextId,
    identity.role,
    navigationCache,
    privateStateAccessAllowed,
    router,
  ]);

  useEffect(
    () => () => {
      const pending = pendingNavigation.current;
      if (pending) {
        window.clearTimeout(pending.timeout);
        pendingNavigation.current = null;
      }
      navigationCache.clear();
      warmSourcePathname.current = null;
      clearNavigationElementState(document.documentElement);
    },
    [navigationCache],
  );

  return null;
}

export function useRuntimeBackNavigation(): () => void {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const router = useRouter();

  return () => {
    if (!privateStateAccessAllowed || !storage) {
      router.back();
      return;
    }
    const target = popRuntimeBack(storage, toNavigationIdentity(identity));
    if (target) {
      router.push(target);
      return;
    }
    router.back();
  };
}
