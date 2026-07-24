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
  isAccountPrivateWriteGenerationCurrent,
} from "~/lib/runtime-state/account-exit";
import { normalizeRuntimeHref } from "~/lib/runtime-state/runtime-state";

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

/**
 * Shell-level adapter. Mount once inside RuntimeStateProvider for each signed-in
 * role shell. It stores only safe route/filter/scroll metadata.
 */
export function RuntimeNavigationBridge({ restoreOnOpen = true }: { restoreOnOpen?: boolean }) {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const openedForIdentity = useRef<string | null>(null);
  const skipPersistHref = useRef<string | null>(null);
  const navigationIdentity = useMemo(
    () => toNavigationIdentity(identity),
    [identity.contextId, identity.role, identity.userId],
  );
  const search = searchParams.toString();
  const href = `${pathname}${search ? `?${search}` : ""}`;
  const safeHref = normalizeRuntimeHref(href, identity.role);
  const identityKey = `${identity.userId}:${identity.role}:${identity.contextId}`;

  useLayoutEffect(() => {
    if (!privateStateAccessAllowed || !storage || !safeHref) return;

    if (restoreOnOpen && openedForIdentity.current !== identityKey) {
      openedForIdentity.current = identityKey;
      const root = identity.role === "producer" ? "/dashboard" : "/artist";
      const resumeHref = readRuntimeResumeHref(storage, navigationIdentity);
      if (safeHref === root && resumeHref && resumeHref !== root) {
        skipPersistHref.current = safeHref;
        router.replace(resumeHref);
        return;
      }
    }

    const snapshot = readRuntimeNavigationSnapshot(storage, navigationIdentity, safeHref);
    return snapshot ? restoreScrollTop(snapshot.scrollTop) : undefined;
  }, [
    identity.role,
    identityKey,
    navigationIdentity,
    privateStateAccessAllowed,
    restoreOnOpen,
    router,
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
      if (!isAccountPrivateWriteGenerationCurrent(writeGeneration)) return;
      recordRuntimeNavigation(storage, navigationIdentity, safeHref, latestScrollTop);
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
  }, [navigationIdentity, privateStateAccessAllowed, safeHref, storage]);

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
