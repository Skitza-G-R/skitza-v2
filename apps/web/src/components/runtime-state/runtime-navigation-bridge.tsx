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
import { normalizeRuntimeHref } from "~/lib/runtime-state/runtime-state";

import { useRuntimeState } from "./runtime-state-provider";

function currentScrollTop(): number {
  const main = document.getElementById("main-content");
  if (main && main.scrollHeight > main.clientHeight) return main.scrollTop;
  return window.scrollY;
}

function restoreScrollTop(scrollTop: number): void {
  window.requestAnimationFrame(() => {
    const main = document.getElementById("main-content");
    if (main && main.scrollHeight > main.clientHeight) {
      main.scrollTo({ top: scrollTop, behavior: "auto" });
      return;
    }
    window.scrollTo({ top: scrollTop, behavior: "auto" });
  });
}

function subscribeToScroll(onScroll: () => void): () => void {
  const main = document.getElementById("main-content");
  const target = main && main.scrollHeight > main.clientHeight ? main : window;
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
    if (snapshot) restoreScrollTop(snapshot.scrollTop);
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

    const existingSnapshot = readRuntimeNavigationSnapshot(storage, navigationIdentity, safeHref);
    recordRuntimeNavigation(
      storage,
      navigationIdentity,
      safeHref,
      existingSnapshot?.scrollTop ?? currentScrollTop(),
    );

    let frame = 0;
    const persist = () => {
      recordRuntimeNavigation(storage, navigationIdentity, safeHref, currentScrollTop());
    };
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(persist);
    };
    const onPageHide = () => {
      persist();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
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
