import { describe, expect, it } from "vitest";

import {
  announceRuntimeMainNavigationIntent,
  ARTIST_MAIN_NAVIGATION_DESTINATIONS,
  captureRuntimeMainNavigationTarget,
  clearRuntimeMainNavigationPendingTargets,
  createRuntimeNavigationSessionCache,
  isSameRuntimeMainNavigationCacheKey,
  PRODUCER_MAIN_NAVIGATION_DESTINATIONS,
  resolveRuntimeMainNavigationHref,
  RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE,
  RUNTIME_MAIN_NAVIGATION_INTENT_EVENT,
  RUNTIME_MAIN_NAVIGATION_LINK_PREFETCH,
  RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE,
  runtimeMainNavigationDestinations,
} from "../navigation-cache";

describe("runtime main navigation destinations", () => {
  it("keeps explicit producer and artist menu lists with automatic Link prefetch disabled", () => {
    expect(RUNTIME_MAIN_NAVIGATION_LINK_PREFETCH).toBe(false);
    expect(PRODUCER_MAIN_NAVIGATION_DESTINATIONS).toEqual([
      "/dashboard",
      "/dashboard/clients-projects",
      "/dashboard/music",
      "/dashboard/calendar",
      "/dashboard/payments",
      "/dashboard/store",
      "/dashboard/portfolio",
      "/dashboard/settings",
    ]);
    expect(ARTIST_MAIN_NAVIGATION_DESTINATIONS).toEqual([
      "/artist",
      "/artist/music",
      "/artist/book",
      "/artist/store",
      "/artist/payments",
    ]);
  });

  it("warms the exact visible producer Calendar key on mobile", () => {
    const desktop = runtimeMainNavigationDestinations({
      role: "producer",
      contextId: "producer-id",
    });
    const mobile = runtimeMainNavigationDestinations({
      role: "producer",
      contextId: "producer-id",
      producerMobile: true,
    });

    expect(desktop).toContain("/dashboard/calendar");
    expect(desktop).not.toContain("/dashboard/calendar?tab=sessions");
    expect(mobile).toContain("/dashboard/calendar?tab=sessions");
    expect(mobile).not.toContain("/dashboard/calendar");
  });

  it("keys every artist destination by the current studio", () => {
    expect(
      runtimeMainNavigationDestinations({
        role: "artist",
        contextId: "studio id",
      }),
    ).toEqual([
      "/artist?studio=studio+id",
      "/artist/music?studio=studio+id",
      "/artist/book?studio=studio+id",
      "/artist/store?studio=studio+id",
      "/artist/payments?studio=studio+id",
    ]);
  });

  it("accepts exact menu hrefs and rejects extra in-page query state", () => {
    const options = { role: "producer" as const, contextId: "producer-id" };
    expect(resolveRuntimeMainNavigationHref("/dashboard/calendar?tab=sessions", options)).toBe(
      "/dashboard/calendar?tab=sessions",
    );
    expect(resolveRuntimeMainNavigationHref("/dashboard/music?view=table", options)).toBeNull();
    expect(
      resolveRuntimeMainNavigationHref("/dashboard/music/project/private", options),
    ).toBeNull();
  });

  it("skips only the current exact full-prefetch cache key", () => {
    expect(
      isSameRuntimeMainNavigationCacheKey(
        "/dashboard/calendar?tab=sessions",
        "/dashboard/calendar",
        "producer",
      ),
    ).toBe(false);
    expect(
      isSameRuntimeMainNavigationCacheKey(
        "/dashboard/calendar?tab=sessions",
        "/dashboard/calendar?tab=sessions",
        "producer",
      ),
    ).toBe(true);
    expect(
      isSameRuntimeMainNavigationCacheKey(
        "/dashboard/music?view=table",
        "/dashboard/music",
        "producer",
      ),
    ).toBe(false);
    expect(
      isSameRuntimeMainNavigationCacheKey("/dashboard/calendar", "/dashboard/music", "producer"),
    ).toBe(false);
  });

  it("announces accepted Next Link navigation intent synchronously", () => {
    const dispatched: Event[] = [];
    const originalWindow = globalThis.window;
    Object.assign(globalThis, {
      window: {
        dispatchEvent(event: Event) {
          dispatched.push(event);
          return true;
        },
      },
    });

    try {
      announceRuntimeMainNavigationIntent("/dashboard/music");
    } finally {
      Object.assign(globalThis, { window: originalWindow });
    }

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe(RUNTIME_MAIN_NAVIGATION_INTENT_EVENT);
    expect((dispatched[0] as CustomEvent).detail).toEqual({
      href: "/dashboard/music",
    });
  });

  it("marks only the accepted target before one frame and clears on replacement, commit, or timeout", () => {
    class Target {
      readonly attributes = new Map<string, string>();

      constructor(href: string) {
        this.attributes.set(RUNTIME_MAIN_NAVIGATION_DESTINATION_ATTRIBUTE, href);
      }

      getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
      }

      removeAttribute(name: string) {
        this.attributes.delete(name);
      }

      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      }
    }

    const music = new Target("/dashboard/music");
    const payments = new Target("/dashboard/payments");
    const targets = [music, payments];
    const root = {
      querySelectorAll() {
        return targets.filter((target) =>
          target.attributes.has(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE),
        );
      },
    };
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const firstFrame = { callback: null as FrameRequestCallback | null };
    Object.assign(globalThis, {
      document: root,
      window: {
        dispatchEvent() {
          return true;
        },
        requestAnimationFrame(callback: FrameRequestCallback) {
          firstFrame.callback = callback;
          return 1;
        },
      },
    });

    try {
      captureRuntimeMainNavigationTarget(music as unknown as EventTarget);
      announceRuntimeMainNavigationIntent("/dashboard/music");

      expect(music.getAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE)).toBe("");
      expect(music.getAttribute("aria-busy")).toBe("true");
      expect(payments.getAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE)).toBeNull();
      expect(firstFrame.callback).toBeNull();

      captureRuntimeMainNavigationTarget(payments as unknown as EventTarget);
      announceRuntimeMainNavigationIntent("/dashboard/payments");
      expect(music.getAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE)).toBeNull();
      expect(music.getAttribute("aria-busy")).toBeNull();
      expect(payments.getAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE)).toBe("");

      // Commit and timeout both use the same target-only settlement helper.
      clearRuntimeMainNavigationPendingTargets(root);
      expect(payments.getAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE)).toBeNull();
      expect(payments.getAttribute("aria-busy")).toBeNull();

      captureRuntimeMainNavigationTarget(music as unknown as EventTarget);
      announceRuntimeMainNavigationIntent("/dashboard/music");
      clearRuntimeMainNavigationPendingTargets(root);
      expect(music.getAttribute(RUNTIME_MAIN_NAVIGATION_PENDING_ATTRIBUTE)).toBeNull();
      expect(music.getAttribute("aria-busy")).toBeNull();
    } finally {
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
      });
    }
  });
});

describe("runtime navigation session readiness", () => {
  it("keys readiness by the exact sorted pathname and query", () => {
    const now = 100;
    const cache = createRuntimeNavigationSessionCache({ now: () => now });
    cache.markReady("/artist/music?studio=two&view=grid");

    expect(cache.isReady("/artist/music?view=grid&studio=two")).toBe(true);
    expect(cache.isReady("/artist/music?studio=two")).toBe(false);
    expect(cache.isReady("/artist/music?studio=one&view=grid")).toBe(false);
  });

  it("expires readiness before Next's 180-second static stale time", () => {
    let now = 0;
    const cache = createRuntimeNavigationSessionCache({
      maxAgeMs: 150_000,
      now: () => now,
    });
    cache.markReady("/dashboard/music");

    now = 150_000;
    expect(cache.isReady("/dashboard/music")).toBe(true);
    now += 1;
    expect(cache.isReady("/dashboard/music")).toBe(false);
  });
});
