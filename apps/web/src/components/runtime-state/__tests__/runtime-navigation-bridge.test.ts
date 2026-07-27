import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  allowAccountPrivateRuntimeWrites,
  clearAccountPrivateRuntimeState,
} from "~/lib/runtime-state/account-exit";
import { NATIVE_REFRESH_EVENT } from "~/lib/pwa/update-coordination";
import {
  popRuntimeBack,
  readRuntimeNavigationSnapshot,
  type RuntimeIdentity,
} from "~/lib/runtime-state/navigation";
import { MemoryStorage } from "~/lib/runtime-state/__tests__/memory-storage";
import { RUNTIME_MAIN_NAVIGATION_INTENT_EVENT } from "~/lib/runtime-state/navigation-cache";

type Effect = () => undefined | (() => void);

const mocked = vi.hoisted(() => ({
  effects: [] as Effect[],
  layoutEffects: [] as Effect[],
  pathname: "/dashboard/calendar",
  persistentRefs: [] as Array<{ current: unknown }>,
  persistRefs: false,
  refIndex: 0,
  search: "tab=availability",
  storage: null as MemoryStorage | null,
  router: {
    back: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: Effect) => {
      mocked.effects.push(effect);
    },
    useLayoutEffect: (effect: Effect) => {
      mocked.layoutEffects.push(effect);
    },
    useMemo: <Value>(factory: () => Value) => factory(),
    useRef: <Value>(initialValue: Value) => {
      if (!mocked.persistRefs) return { current: initialValue };
      const index = mocked.refIndex;
      mocked.refIndex += 1;
      const existing = mocked.persistentRefs[index];
      if (existing) return existing as { current: Value };
      const created = { current: initialValue };
      mocked.persistentRefs[index] = created;
      return created;
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => mocked.pathname,
  useRouter: () => mocked.router,
  useSearchParams: () => new URLSearchParams(mocked.search),
}));

vi.mock("../runtime-state-provider", () => ({
  useRuntimeState: () => ({
    identity: {
      userId: "producer-user",
      role: "producer",
      contextId: "producer-id",
    },
    privateStateAccessAllowed: true,
    storage: mocked.storage,
  }),
}));

import { afterRuntimeNavigationPaint, RuntimeNavigationBridge } from "../runtime-navigation-bridge";

const PRODUCER: RuntimeIdentity = {
  userId: "producer-user",
  role: "producer",
  contextId: "producer-id",
};
const CALENDAR_HREF = "/dashboard/calendar?tab=availability";

beforeEach(() => {
  mocked.effects.length = 0;
  mocked.layoutEffects.length = 0;
  mocked.pathname = "/dashboard/calendar";
  mocked.persistentRefs.length = 0;
  mocked.persistRefs = false;
  mocked.refIndex = 0;
  mocked.search = "tab=availability";
  mocked.storage = new MemoryStorage();
  mocked.router.back.mockReset();
  mocked.router.prefetch.mockReset();
  mocked.router.push.mockReset();
  mocked.router.replace.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setupScrollEnvironment() {
  class MockHTMLElement extends EventTarget {}
  vi.stubGlobal("HTMLElement", MockHTMLElement);
  const main = Object.assign(new MockHTMLElement(), {
    clientHeight: 781,
    scrollHeight: 2292,
    scrollTop: 0,
    scrollTo({ top }: { top: number }) {
      this.scrollTop = top;
    },
  });
  const animation = {
    scheduledFrame: null as FrameRequestCallback | null,
  };
  const browserWindow = Object.assign(new EventTarget(), {
    scrollY: 0,
    getComputedStyle() {
      return { overflowY: "auto" };
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      animation.scheduledFrame = callback;
      return 1;
    },
    cancelAnimationFrame() {
      animation.scheduledFrame = null;
    },
    scrollTo({ top }: { top: number }) {
      this.scrollY = top;
    },
  });
  const browserDocument = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    getElementById(id: string) {
      return id === "main-content" ? main : null;
    },
  });
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
  return { animation, main };
}

function renderBridge(): undefined | (() => void) {
  const layoutEffectIndex = mocked.layoutEffects.length;
  const effectIndex = mocked.effects.length;
  RuntimeNavigationBridge({ restoreOnOpen: false });
  mocked.layoutEffects[layoutEffectIndex]?.();
  return mocked.effects[effectIndex]?.();
}

function currentStorage(): MemoryStorage {
  if (!mocked.storage) throw new Error("Expected runtime storage");
  return mocked.storage;
}

function setupNavigationIntentEnvironment() {
  const listeners = new Map<string, EventListener>();
  const targetAttributes = new Map<string, string>();
  const pendingTarget = {
    getAttribute(name: string) {
      return targetAttributes.get(name) ?? null;
    },
    removeAttribute(name: string) {
      targetAttributes.delete(name);
    },
    setAttribute(name: string, value: string) {
      targetAttributes.set(name, value);
    },
  };
  const pendingTargets = () =>
    targetAttributes.has("data-sk-nav-pending") ? [pendingTarget] : [];
  const root = {
    dataset: {} as Record<string, string>,
    querySelectorAll: pendingTargets,
  };
  const clearTimeout = vi.fn();
  const frames: FrameRequestCallback[] = [];
  let timeoutCallback: (() => void) | null = null;
  const timing = {
    clearMarks: vi.fn(),
    clearMeasures: vi.fn(),
    mark: vi.fn(),
    measure: vi.fn(),
  };
  const browserWindow = {
    location: {
      href: "https://skitza.test/dashboard/calendar?tab=availability",
      origin: "https://skitza.test",
    },
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: vi.fn(),
    setTimeout(callback: () => void) {
      timeoutCallback = callback;
      return 17;
    },
    clearTimeout,
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.(event);
      return true;
    },
  };
  const browserDocument = {
    documentElement: root,
    querySelectorAll: pendingTargets,
    visibilityState: "visible",
  };
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("performance", timing);

  return {
    clearTimeout,
    pendingTarget,
    root,
    timing,
    announce(href: string) {
      pendingTarget.setAttribute("data-sk-nav-pending", "");
      pendingTarget.setAttribute("aria-busy", "true");
      listeners.get(RUNTIME_MAIN_NAVIGATION_INTENT_EVENT)?.({
        detail: { href },
      } as unknown as Event);
    },
    runCommitFrames() {
      frames[0]?.(0);
      frames[1]?.(16);
    },
    timeout() {
      timeoutCallback?.();
    },
  };
}

describe("RuntimeNavigationBridge scroll persistence", () => {
  it("does not overwrite the previous route after the shared scroll container resets", () => {
    const { animation, main } = setupScrollEnvironment();
    const cleanup = renderBridge();
    main.scrollTop = 900;
    main.dispatchEvent(new Event("scroll"));
    const frame = animation.scheduledFrame;
    if (frame) frame(0);
    expect(
      readRuntimeNavigationSnapshot(currentStorage(), PRODUCER, CALENDAR_HREF)?.scrollTop,
    ).toBe(900);

    // The persistent shell reuses this element for Music before the old route
    // effect cleans up. Cleanup must keep Availability's last observed value.
    main.scrollTop = 0;
    main.scrollHeight = main.clientHeight;
    if (typeof cleanup === "function") cleanup();

    expect(
      readRuntimeNavigationSnapshot(currentStorage(), PRODUCER, CALENDAR_HREF)?.scrollTop,
    ).toBe(900);
  });

  it("does not recreate cleared navigation state from a queued frame or effect cleanup", () => {
    const { animation, main } = setupScrollEnvironment();
    const cleanup = renderBridge();
    // Live-only Calendar persists navigation history, but cannot replace the
    // last durable safe-screen launch pointer.
    expect(mocked.storage?.length).toBe(2);

    main.scrollTop = 640;
    main.dispatchEvent(new Event("scroll"));
    const staleFrame = animation.scheduledFrame;

    expect(clearAccountPrivateRuntimeState(PRODUCER.userId, mocked.storage)).toBe(2);
    expect(mocked.storage?.length).toBe(0);

    staleFrame?.(0);
    if (typeof cleanup === "function") cleanup();

    expect(mocked.storage?.length).toBe(0);
    expect(readRuntimeNavigationSnapshot(currentStorage(), PRODUCER, CALENDAR_HREF)).toBeNull();
  });

  it("allows a fresh bridge for the same account to persist and restore navigation", () => {
    const { animation, main } = setupScrollEnvironment();
    clearAccountPrivateRuntimeState(PRODUCER.userId, mocked.storage);
    allowAccountPrivateRuntimeWrites(PRODUCER.userId);

    const cleanup = renderBridge();
    main.scrollTop = 420;
    main.dispatchEvent(new Event("scroll"));
    animation.scheduledFrame?.(0);

    expect(
      readRuntimeNavigationSnapshot(currentStorage(), PRODUCER, CALENDAR_HREF)?.scrollTop,
    ).toBe(420);
    if (typeof cleanup === "function") cleanup();

    mocked.pathname = "/dashboard/music";
    mocked.search = "";
    const nextCleanup = renderBridge();
    expect(popRuntimeBack(currentStorage(), PRODUCER)).toBe(CALENDAR_HREF);

    if (typeof nextCleanup === "function") nextCleanup();
  });
});

describe("RuntimeNavigationBridge navigation intent", () => {
  it("sets pending feedback synchronously and clears every html marker on shell exit", () => {
    const environment = setupNavigationIntentEnvironment();
    const layoutEffectIndex = mocked.layoutEffects.length;
    const effectIndex = mocked.effects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });

    const cleanupIntent = mocked.layoutEffects[layoutEffectIndex + 2]?.();
    const cleanupShell = mocked.effects[effectIndex + 3]?.();
    environment.announce("/dashboard/music");

    expect(environment.root.dataset.skNavState).toBe("pending");
    expect(environment.root.dataset.skNavSource).toBeUndefined();
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBe("");
    expect(environment.pendingTarget.getAttribute("aria-busy")).toBe("true");
    expect(environment.timing.mark).toHaveBeenCalledWith("skitza:navigation:intent");

    environment.root.dataset.skNavSource = "warm";
    if (typeof cleanupShell === "function") cleanupShell();
    expect(environment.root.dataset).toEqual({});
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBeNull();
    expect(environment.pendingTarget.getAttribute("aria-busy")).toBeNull();
    expect(environment.clearTimeout).toHaveBeenCalledWith(17);

    if (typeof cleanupIntent === "function") cleanupIntent();
  });

  it("quietly re-prefetches only the active main route on foreground freshness", () => {
    const environment = setupNavigationIntentEnvironment();
    const effectIndex = mocked.effects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });
    const cleanupFreshness = mocked.effects[effectIndex + 1]?.();

    window.dispatchEvent(new Event(NATIVE_REFRESH_EVENT));

    expect(mocked.router.prefetch).toHaveBeenCalledOnce();
    expect(mocked.router.prefetch).toHaveBeenCalledWith(CALENDAR_HREF);
    if (typeof cleanupFreshness === "function") cleanupFreshness();
    void environment;
  });

  it("clears the exact pending target when a delayed navigation times out", () => {
    const environment = setupNavigationIntentEnvironment();
    const layoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });
    const cleanupIntent = mocked.layoutEffects[layoutEffectIndex + 2]?.();

    environment.announce("/dashboard/music");
    environment.timeout();

    expect(environment.root.dataset.skNavState).toBe("settled");
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBeNull();
    expect(environment.pendingTarget.getAttribute("aria-busy")).toBeNull();

    if (typeof cleanupIntent === "function") cleanupIntent();
  });

  it("fully aborts a pending destination when the current or an invalid target is announced", () => {
    const environment = setupNavigationIntentEnvironment();
    mocked.search = "tab=sessions";
    mocked.persistRefs = true;
    mocked.refIndex = 0;
    const layoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });
    const cleanupIntent = mocked.layoutEffects[layoutEffectIndex + 2]?.();

    environment.announce("/dashboard/music");
    expect(environment.root.dataset.skNavState).toBe("pending");
    environment.root.dataset.skNavSource = "warm";
    const warmSourceRef = mocked.persistentRefs[5];
    if (!warmSourceRef) throw new Error("Expected the warm source ref");
    warmSourceRef.current = "/dashboard/music";

    environment.announce("/dashboard/calendar?tab=sessions");

    expect(environment.clearTimeout).toHaveBeenCalledWith(17);
    expect(mocked.persistentRefs[2]?.current).toBeNull();
    expect(warmSourceRef.current).toBeNull();
    expect(environment.root.dataset).toEqual({});
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBeNull();
    expect(environment.pendingTarget.getAttribute("aria-busy")).toBeNull();
    expect(environment.timing.mark).toHaveBeenCalledTimes(1);
    expect(environment.timing.measure).not.toHaveBeenCalled();

    environment.timeout();
    expect(environment.root.dataset).toEqual({});

    environment.announce("/dashboard/store");
    expect(environment.root.dataset.skNavState).toBe("pending");
    expect(environment.root.dataset.skNavSource).toBeUndefined();
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBe("");
    expect(environment.pendingTarget.getAttribute("aria-busy")).toBe("true");
    expect(
      (mocked.persistentRefs[2]?.current as { href?: string } | null)?.href,
    ).toBe("/dashboard/store");
    expect(environment.timing.mark).toHaveBeenCalledTimes(2);

    environment.announce("/dashboard/not-main");
    expect(mocked.persistentRefs[2]?.current).toBeNull();
    expect(environment.root.dataset).toEqual({});
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBeNull();
    expect(environment.pendingTarget.getAttribute("aria-busy")).toBeNull();
    expect(environment.timing.measure).not.toHaveBeenCalled();
    environment.timeout();
    expect(environment.root.dataset).toEqual({});

    if (typeof cleanupIntent === "function") cleanupIntent();
  });

  it("clears the exact pending target after the destination commits and paints", () => {
    const environment = setupNavigationIntentEnvironment();
    mocked.persistRefs = true;
    mocked.refIndex = 0;
    const intentLayoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });
    const cleanupIntent = mocked.layoutEffects[intentLayoutEffectIndex + 2]?.();

    environment.announce("/dashboard/music");
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBe("");

    mocked.pathname = "/dashboard/music";
    mocked.search = "";
    mocked.refIndex = 0;
    const layoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });
    mocked.layoutEffects[layoutEffectIndex + 1]?.();
    environment.runCommitFrames();

    expect(environment.root.dataset.skNavState).toBe("settled");
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBeNull();
    expect(environment.pendingTarget.getAttribute("aria-busy")).toBeNull();
    expect(environment.timing.measure).toHaveBeenCalledWith(
      "skitza:navigation:intent-to-commit",
      "skitza:navigation:intent",
      "skitza:navigation:commit",
    );

    if (typeof cleanupIntent === "function") cleanupIntent();
  });

  it("records a route commit only after two painted frames", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("window", {
      requestAnimationFrame(callback: FrameRequestCallback) {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame: vi.fn(),
    });
    const commit = vi.fn();

    afterRuntimeNavigationPaint(commit);
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(commit).not.toHaveBeenCalled();
    frames[1]?.(16);
    expect(commit).toHaveBeenCalledOnce();
  });
});
