import { describe, expect, it, vi } from "vitest";

import { createRuntimeNavigationSessionCache } from "../navigation-cache";
import {
  markRuntimeNavigationIntent,
  RUNTIME_NAVIGATION_COMMIT_MARK,
  RUNTIME_NAVIGATION_COMMIT_MEASURE,
  RUNTIME_NAVIGATION_INTENT_MARK,
  runtimeResourceCompletionForHref,
  scheduleRuntimeIdleFallback,
  startObservedRuntimeRequest,
  startRuntimeRouteWarming,
  type RuntimeObservedResourceTiming,
  type RuntimePrefetchCompletion,
} from "../route-warming";

describe("Safari runtime idle fallback", () => {
  it("waits for load, two painted frames, and a quiet delay", () => {
    let loaded = false;
    const loadListeners: Array<() => void> = [];
    const frames: Array<() => void> = [];
    const timeouts: Array<() => void> = [];
    const callback = vi.fn();

    scheduleRuntimeIdleFallback(callback, {
      isDocumentLoaded: () => loaded,
      subscribeToLoad(listener) {
        loadListeners.push(listener);
        return () => {
          const index = loadListeners.indexOf(listener);
          if (index >= 0) loadListeners.splice(index, 1);
        };
      },
      requestAnimationFrame(listener) {
        frames.push(listener);
        return frames.length;
      },
      cancelAnimationFrame: vi.fn(),
      setTimeout(listener, delayMs) {
        expect(delayMs).toBe(600);
        timeouts.push(listener);
        return 12;
      },
      clearTimeout: vi.fn(),
    });

    expect(frames).toHaveLength(0);
    loaded = true;
    loadListeners[0]?.();
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(frames).toHaveLength(2);
    frames[1]?.();
    expect(callback).not.toHaveBeenCalled();
    timeouts[0]?.();
    expect(callback).toHaveBeenCalledOnce();
  });
});

describe("runtime RSC completion matching", () => {
  it("removes only _rsc, requires the exact query, and verifies a successful status", () => {
    const origin = "https://skitza.test";
    expect(
      runtimeResourceCompletionForHref(
        {
          name: `${origin}/artist/music?_rsc=abc&studio=studio-1`,
          responseStatusSupported: true,
          responseStatus: 200,
        },
        "/artist/music?studio=studio-1",
        origin,
      ),
    ).toBe("success");
    expect(
      runtimeResourceCompletionForHref(
        {
          name: `${origin}/artist/music?studio=studio-1&_rsc=abc&view=grid`,
          responseStatusSupported: true,
          responseStatus: 200,
        },
        "/artist/music?studio=studio-1",
        origin,
      ),
    ).toBeNull();
    expect(
      runtimeResourceCompletionForHref(
        {
          name: `${origin}/artist/music?_rsc=abc&studio=studio-2`,
          responseStatusSupported: true,
          responseStatus: 200,
        },
        "/artist/music?studio=studio-1",
        origin,
      ),
    ).toBeNull();
    expect(
      runtimeResourceCompletionForHref(
        {
          name: `${origin}/artist/music?studio=studio-1`,
          responseStatusSupported: true,
          responseStatus: 200,
        },
        "/artist/music?studio=studio-1",
        origin,
      ),
    ).toBeNull();
  });

  it("rejects HTTP failures and status values that cannot prove success", () => {
    const origin = "https://skitza.test";
    const resource = (responseStatus?: number): RuntimeObservedResourceTiming => ({
      name: `${origin}/dashboard/music?_rsc=ready`,
      responseStatusSupported: true,
      responseStatus,
    });

    expect(
      runtimeResourceCompletionForHref(resource(404), "/dashboard/music", origin),
    ).toBe("http-failure");
    expect(
      runtimeResourceCompletionForHref(resource(503), "/dashboard/music", origin),
    ).toBe("http-failure");
    expect(runtimeResourceCompletionForHref(resource(0), "/dashboard/music", origin)).toBe(
      "unverified",
    );
    expect(runtimeResourceCompletionForHref(resource(), "/dashboard/music", origin)).toBe(
      "unverified",
    );
  });

  it("uses a distinct UX-only completion when Safari has no responseStatus property", () => {
    const origin = "https://skitza.test";

    expect(
      runtimeResourceCompletionForHref(
        {
          name: `${origin}/dashboard/music?_rsc=ready`,
          responseStatusSupported: false,
        },
        "/dashboard/music",
        origin,
      ),
    ).toBe("safari-compatible");
  });
});

describe("observed runtime requests", () => {
  function setupObservedRequest() {
    let resourceListener: ((resource: RuntimeObservedResourceTiming) => void) | null = null;
    let timeoutCallback: (() => void) | null = null;
    const clearTimeout = vi.fn();
    const start = vi.fn();
    const onComplete = vi.fn<(completion: RuntimePrefetchCompletion) => void>();

    const cancel = startObservedRuntimeRequest({
      href: "/dashboard/music",
      origin: "https://skitza.test",
      start,
      onComplete,
      subscribeToResources(callback) {
        resourceListener = callback;
        return () => {
          resourceListener = null;
        };
      },
      timers: {
        clearTimeout,
        setTimeout(callback) {
          timeoutCallback = callback;
          return 41;
        },
      },
    });
    return {
      cancel,
      clearTimeout,
      onComplete,
      resource: (
        name: string,
        responseStatus?: number,
        responseStatusSupported = true,
      ) => resourceListener?.({ name, responseStatus, responseStatusSupported }),
      start,
      timeout: () => timeoutCallback?.(),
    };
  }

  it("settles successfully only after the exact RSC resource returns 2xx", () => {
    const request = setupObservedRequest();
    expect(request.start).toHaveBeenCalledOnce();
    expect(request.onComplete).not.toHaveBeenCalled();

    request.resource("https://skitza.test/dashboard/music?view=grid&_rsc=wrong", 200);
    expect(request.onComplete).not.toHaveBeenCalled();
    request.resource("https://skitza.test/dashboard/music?_rsc=ready", 204);
    expect(request.onComplete).toHaveBeenCalledWith("success");
  });

  it.each([
    { expected: "http-failure", responseStatus: 404 },
    { expected: "http-failure", responseStatus: 500 },
    { expected: "unverified", responseStatus: 0 },
    { expected: "unverified", responseStatus: undefined },
  ] as const)(
    "settles as $expected for exact RSC status $responseStatus",
    ({ expected, responseStatus }) => {
      const request = setupObservedRequest();
      request.resource("https://skitza.test/dashboard/music?_rsc=ready", responseStatus);
      expect(request.onComplete).toHaveBeenCalledWith(expected);
    },
  );

  it("settles with the Safari-compatible result only when responseStatus is unsupported", () => {
    const request = setupObservedRequest();
    request.resource(
      "https://skitza.test/dashboard/music?_rsc=ready",
      undefined,
      false,
    );
    expect(request.onComplete).toHaveBeenCalledWith("safari-compatible");
  });

  it("settles as an error when router.prefetch throws", () => {
    const onComplete = vi.fn<(completion: RuntimePrefetchCompletion) => void>();
    startObservedRuntimeRequest({
      href: "/dashboard/music",
      origin: "https://skitza.test",
      onComplete,
      start() {
        throw new Error("prefetch failed");
      },
      timers: {
        clearTimeout: vi.fn(),
        setTimeout: () => 51,
      },
    });

    expect(onComplete).toHaveBeenCalledWith("error");
  });

  it("fails closed on timeout and ignores completion after cancellation", () => {
    const timedOut = setupObservedRequest();
    timedOut.timeout();
    expect(timedOut.onComplete).toHaveBeenCalledWith("timeout");

    const cancelled = setupObservedRequest();
    cancelled.cancel();
    cancelled.resource("https://skitza.test/dashboard/music?_rsc=late");
    cancelled.timeout();
    expect(cancelled.onComplete).not.toHaveBeenCalled();
  });
});

describe("serial runtime route warming", () => {
  function setupScheduler(
    currentHref = "/dashboard",
    {
      throwFirstPrefetch = false,
      warmCurrent = false,
    }: { throwFirstPrefetch?: boolean; warmCurrent?: boolean } = {},
  ) {
    let active = true;
    let activity: (() => void) | null = null;
    const idleCallbacks: Array<{
      callback: () => void;
      cancelled: boolean;
    }> = [];
    const prefetches: Array<{
      href: string;
      complete: (completion: RuntimePrefetchCompletion) => void;
      cancelled: boolean;
    }> = [];
    const cache = createRuntimeNavigationSessionCache();

    const cancel = startRuntimeRouteWarming({
      cache,
      currentHref,
      destinations: ["/dashboard", "/dashboard/music", "/dashboard/payments"],
      role: "producer",
      isActive: () => active,
      scheduleIdle(callback) {
        const scheduled = { callback, cancelled: false };
        idleCallbacks.push(scheduled);
        return () => {
          scheduled.cancelled = true;
        };
      },
      startPrefetch(href, complete) {
        const prefetch = { href, complete, cancelled: false };
        prefetches.push(prefetch);
        if (throwFirstPrefetch && prefetches.length === 1) {
          throw new Error("prefetch adapter failed");
        }
        return () => {
          prefetch.cancelled = true;
        };
      },
      subscribeToActivity(callback) {
        activity = callback;
        return () => {
          activity = null;
        };
      },
      warmCurrent,
    });

    const runNextIdle = () => {
      const idle = idleCallbacks.find((candidate) => !candidate.cancelled);
      if (!idle) throw new Error("Expected an idle callback");
      idle.cancelled = true;
      idle.callback();
    };
    const completePrefetch = (index: number, completion: RuntimePrefetchCompletion) => {
      const prefetch = prefetches[index];
      if (!prefetch || prefetch.cancelled) return;
      prefetch.complete(completion);
    };
    return {
      activity: () => activity?.(),
      cache,
      cancel,
      completePrefetch,
      idleCallbacks,
      prefetches,
      runNextIdle,
      setActive(value: boolean) {
        active = value;
      },
    };
  }

  it.each(["success", "safari-compatible"] as const)(
    "marks a destination ready after %s completion and then schedules the next",
    (completion) => {
      const scheduler = setupScheduler();
      expect(scheduler.idleCallbacks).toHaveLength(1);

      scheduler.runNextIdle();
      expect(scheduler.prefetches.map(({ href }) => href)).toEqual(["/dashboard/music"]);
      expect(scheduler.idleCallbacks).toHaveLength(1);
      expect(scheduler.cache.isReady("/dashboard/music")).toBe(false);

      scheduler.completePrefetch(0, completion);
      expect(scheduler.cache.isReady("/dashboard/music")).toBe(true);
      expect(scheduler.idleCallbacks).toHaveLength(2);
      scheduler.runNextIdle();
      expect(scheduler.prefetches.map(({ href }) => href)).toEqual([
        "/dashboard/music",
        "/dashboard/payments",
      ]);
    },
  );

  it.each(["http-failure", "unverified", "error", "timeout"] as const)(
    "does not mark ready after %s and advances to the next serial destination",
    (completion) => {
      const scheduler = setupScheduler();
      scheduler.runNextIdle();
      scheduler.completePrefetch(0, completion);

      expect(scheduler.cache.isReady("/dashboard/music")).toBe(false);
      expect(scheduler.idleCallbacks).toHaveLength(2);
      expect(scheduler.prefetches).toHaveLength(1);

      scheduler.runNextIdle();
      expect(scheduler.prefetches.map(({ href }) => href)).toEqual([
        "/dashboard/music",
        "/dashboard/payments",
      ]);
      expect(scheduler.cache.isReady("/dashboard/payments")).toBe(false);
    },
  );

  it("advances when the prefetch adapter itself throws", () => {
    const scheduler = setupScheduler("/dashboard", { throwFirstPrefetch: true });

    expect(() => {
      scheduler.runNextIdle();
    }).not.toThrow();
    expect(scheduler.cache.isReady("/dashboard/music")).toBe(false);
    expect(scheduler.idleCallbacks).toHaveLength(2);

    scheduler.runNextIdle();
    expect(scheduler.prefetches.map(({ href }) => href)).toEqual([
      "/dashboard/music",
      "/dashboard/payments",
    ]);
  });

  it("warms a menu key when the current route has different query state", () => {
    const scheduler = setupScheduler("/dashboard/music?view=table");
    scheduler.runNextIdle();
    expect(scheduler.prefetches[0]?.href).toBe("/dashboard");
    scheduler.completePrefetch(0, "success");
    scheduler.runNextIdle();
    expect(scheduler.prefetches[1]?.href).toBe("/dashboard/music");
  });

  it("warms the current route last after a proven cache-clearing refresh", () => {
    const scheduler = setupScheduler("/dashboard", { warmCurrent: true });

    scheduler.runNextIdle();
    expect(scheduler.prefetches[0]?.href).toBe("/dashboard/music");
    scheduler.completePrefetch(0, "success");
    scheduler.runNextIdle();
    expect(scheduler.prefetches[1]?.href).toBe("/dashboard/payments");
    scheduler.completePrefetch(1, "success");
    scheduler.runNextIdle();
    expect(scheduler.prefetches[2]?.href).toBe("/dashboard");
  });

  it("lets an in-flight request finish while inactive but starts no next request", () => {
    const scheduler = setupScheduler();
    scheduler.runNextIdle();
    expect(scheduler.prefetches[0]?.href).toBe("/dashboard/music");

    scheduler.setActive(false);
    scheduler.activity();
    expect(scheduler.prefetches[0]?.cancelled).toBe(false);
    scheduler.completePrefetch(0, "success");
    expect(scheduler.cache.isReady("/dashboard/music")).toBe(true);
    expect(scheduler.idleCallbacks).toHaveLength(1);

    scheduler.setActive(true);
    scheduler.activity();
    scheduler.runNextIdle();
    expect(scheduler.prefetches[1]?.href).toBe("/dashboard/payments");
  });

  it("cancels an idle slot and active observer safely on teardown", () => {
    const beforeIdle = setupScheduler();
    beforeIdle.cancel();
    expect(beforeIdle.idleCallbacks[0]?.cancelled).toBe(true);

    const duringPrefetch = setupScheduler();
    duringPrefetch.runNextIdle();
    duringPrefetch.cancel();
    expect(duringPrefetch.prefetches[0]?.cancelled).toBe(true);
  });
});

describe("runtime navigation timing", () => {
  it("clears the prior intent-to-commit measure before marking a new intent", () => {
    const calls: string[] = [];

    markRuntimeNavigationIntent({
      clearMarks(name) {
        calls.push(`clear mark:${name ?? "<all>"}`);
      },
      clearMeasures(name) {
        calls.push(`clear measure:${name ?? "<all>"}`);
      },
      mark(name) {
        calls.push(`mark:${name}`);
        return {} as PerformanceMark;
      },
    });

    expect(calls).toEqual([
      `clear measure:${RUNTIME_NAVIGATION_COMMIT_MEASURE}`,
      `clear mark:${RUNTIME_NAVIGATION_INTENT_MARK}`,
      `clear mark:${RUNTIME_NAVIGATION_COMMIT_MARK}`,
      `mark:${RUNTIME_NAVIGATION_INTENT_MARK}`,
    ]);
  });
});
