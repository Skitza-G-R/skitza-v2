import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  allowAccountPrivateRuntimeWrites,
  clearAccountPrivateRuntimeState,
} from "~/lib/runtime-state/account-exit";
import { NATIVE_REFRESH_EVENT } from "~/lib/pwa/update-coordination";
import {
  popRuntimeBack,
  readRuntimeNavigationIndex,
  readRuntimeNavigationSnapshot,
  recordRuntimeNavigation,
  type RuntimeIdentity,
} from "~/lib/runtime-state/navigation";
import { MemoryStorage } from "~/lib/runtime-state/__tests__/memory-storage";
import { RUNTIME_MAIN_NAVIGATION_INTENT_EVENT } from "~/lib/runtime-state/navigation-cache";
import {
  readRuntimeLaunchTarget,
  readRuntimeLaunchTargetForRole,
  writeRuntimeLaunchPointer,
} from "~/lib/runtime-state/runtime-state";

type Effect = () => undefined | (() => void);
interface CapturedEffect {
  run: Effect;
  source: string;
}

const mocked = vi.hoisted(() => ({
  effects: [] as CapturedEffect[],
  identity: {
    userId: "producer-user",
    role: "producer" as "producer" | "artist",
    contextId: "producer-id",
  },
  layoutEffects: [] as CapturedEffect[],
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
      mocked.effects.push({ run: effect, source: effect.toString() });
    },
    useLayoutEffect: (effect: Effect) => {
      mocked.layoutEffects.push({ run: effect, source: effect.toString() });
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
    identity: mocked.identity,
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
  mocked.identity = {
    userId: "producer-user",
    role: "producer",
    contextId: "producer-id",
  };
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

function findEffect(
  effects: CapturedEffect[],
  startIndex: number,
  marker: string,
  excludedMarker?: string,
): Effect {
  const matches = effects
    .slice(startIndex)
    .filter(
      (effect) =>
        effect.source.includes(marker) &&
        (!excludedMarker || !effect.source.includes(excludedMarker)),
    );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one effect containing ${marker}, found ${matches.length.toString()}`,
    );
  }
  const match = matches[0];
  if (!match) throw new Error(`Expected an effect containing ${marker}`);
  return match.run;
}

function renderBridge(): undefined | (() => void) {
  const layoutEffectIndex = mocked.layoutEffects.length;
  const effectIndex = mocked.effects.length;
  RuntimeNavigationBridge({ restoreOnOpen: false });
  findEffect(
    mocked.layoutEffects,
    layoutEffectIndex,
    "readRuntimeNavigationSnapshot",
  )();
  return findEffect(mocked.effects, effectIndex, "subscribeToScroll")();
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

function setupRoleTouchEnvironment() {
  const browserWindow = new EventTarget();
  const browserDocument = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
  return {
    hide() {
      browserDocument.visibilityState = "hidden";
      browserDocument.dispatchEvent(new Event("visibilitychange"));
    },
    pagehide() {
      browserWindow.dispatchEvent(new Event("pagehide"));
    },
  };
}

describe("RuntimeNavigationBridge root restoration", () => {
  it("keeps the explicit post-onboarding Store cue on the dashboard root", () => {
    mocked.pathname = "/dashboard";
    mocked.search = "storeTip=1";
    mocked.persistRefs = true;
    recordRuntimeNavigation(
      currentStorage(),
      PRODUCER,
      "/dashboard/store",
      0,
    );

    const layoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({});
    findEffect(
      mocked.layoutEffects,
      layoutEffectIndex,
      "readRuntimeNavigationSnapshot",
    )();

    expect(mocked.router.replace).not.toHaveBeenCalled();

    // Consuming the cue query must not make the same mounted shell resume away
    // from Overview on its next render.
    mocked.search = "";
    mocked.refIndex = 0;
    const nextLayoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({});
    findEffect(
      mocked.layoutEffects,
      nextLayoutEffectIndex,
      "readRuntimeNavigationSnapshot",
    )();

    expect(mocked.router.replace).not.toHaveBeenCalled();
  });

  it("still resumes the last producer screen for an ordinary dashboard root", () => {
    mocked.pathname = "/dashboard";
    mocked.search = "";
    recordRuntimeNavigation(
      currentStorage(),
      PRODUCER,
      "/dashboard/store",
      0,
    );

    const layoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({});
    findEffect(
      mocked.layoutEffects,
      layoutEffectIndex,
      "readRuntimeNavigationSnapshot",
    )();

    expect(mocked.router.replace).toHaveBeenCalledWith("/dashboard/store");
  });
});

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

describe("RuntimeNavigationBridge role launch persistence", () => {
  it("records only the safe Artist root pointer from a live booking route", () => {
    setupRoleTouchEnvironment();
    mocked.identity = {
      userId: "dual-user",
      role: "artist",
      contextId: "studio-id",
    };
    mocked.pathname = "/artist/book";
    mocked.search = "studio=studio-id&producer=producer-id";
    const effectIndex = mocked.effects.length;

    RuntimeNavigationBridge({ restoreOnOpen: false });
    const cleanup = findEffect(
      mocked.effects,
      effectIndex,
      "writeRuntimeLaunchPointer",
      "subscribeToScroll",
    )();

    expect(
      readRuntimeLaunchTargetForRole(
        currentStorage(),
        "dual-user",
        "artist",
      ),
    ).toEqual({
      role: "artist",
      contextId: "studio-id",
      href: "/artist?studio=studio-id",
    });
    expect(
      readRuntimeNavigationIndex(currentStorage(), {
        userId: "dual-user",
        role: "artist",
        contextId: "studio-id",
      }),
    ).toBeNull();
    expect(
      Array.from({ length: currentStorage().length }, (_, index) =>
        currentStorage().getItem(currentStorage().key(index) ?? ""),
      ).join("\n"),
    ).not.toContain("/artist/book");
    if (typeof cleanup === "function") cleanup();
  });

  it("refreshes the same-context Artist pointer through the live-route lifecycle without replacing Music with Book", () => {
    const environment = setupRoleTouchEnvironment();
    const artist: RuntimeIdentity = {
      userId: "dual-user",
      role: "artist",
      contextId: "studio-id",
    };
    mocked.identity = artist;
    mocked.pathname = "/artist/book";
    mocked.search = "studio=studio-id&producer=producer-id";
    const now = Date.now();
    expect(
      writeRuntimeLaunchPointer(
        currentStorage(),
        artist,
        "/artist/music?studio=studio-id",
        now - 20,
      ),
    ).toBe(true);
    expect(
      writeRuntimeLaunchPointer(
        currentStorage(),
        { userId: "dual-user", role: "producer", contextId: "producer-id" },
        "/dashboard/music",
        now - 10,
      ),
    ).toBe(true);
    const setItem = vi.spyOn(currentStorage(), "setItem");
    const effectIndex = mocked.effects.length;

    RuntimeNavigationBridge({ restoreOnOpen: false });
    const cleanup = findEffect(
      mocked.effects,
      effectIndex,
      "writeRuntimeLaunchPointer",
      "subscribeToScroll",
    )();
    expect(setItem).toHaveBeenCalledTimes(1);
    environment.pagehide();
    expect(setItem).toHaveBeenCalledTimes(2);
    environment.hide();
    expect(setItem).toHaveBeenCalledTimes(3);
    if (typeof cleanup === "function") cleanup();
    expect(setItem).toHaveBeenCalledTimes(4);

    expect(readRuntimeLaunchTarget(currentStorage(), "dual-user")).toEqual({
      role: "artist",
      contextId: "studio-id",
      href: "/artist/music?studio=studio-id",
    });
    expect(
      Array.from({ length: currentStorage().length }, (_, index) =>
        currentStorage().getItem(currentStorage().key(index) ?? ""),
      ).join("\n"),
    ).not.toContain("/artist/book");
  });

  it("blocks every later live-route touch after private account state is cleared", () => {
    const environment = setupRoleTouchEnvironment();
    mocked.identity = {
      userId: "cleared-dual-user",
      role: "artist",
      contextId: "studio-id",
    };
    mocked.pathname = "/artist/book";
    mocked.search = "studio=studio-id";
    const setItem = vi.spyOn(currentStorage(), "setItem");
    const effectIndex = mocked.effects.length;

    RuntimeNavigationBridge({ restoreOnOpen: false });
    const cleanup = findEffect(
      mocked.effects,
      effectIndex,
      "writeRuntimeLaunchPointer",
      "subscribeToScroll",
    )();
    expect(setItem).toHaveBeenCalledTimes(1);
    clearAccountPrivateRuntimeState("cleared-dual-user", currentStorage());

    environment.pagehide();
    environment.hide();
    if (typeof cleanup === "function") cleanup();

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(currentStorage().length).toBe(0);
  });
});

describe("RuntimeNavigationBridge navigation intent", () => {
  it("sets pending feedback synchronously and clears every html marker on shell exit", () => {
    const environment = setupNavigationIntentEnvironment();
    const layoutEffectIndex = mocked.layoutEffects.length;
    const effectIndex = mocked.effects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });

    const cleanupIntent = findEffect(
      mocked.layoutEffects,
      layoutEffectIndex,
      "RUNTIME_MAIN_NAVIGATION_INTENT_EVENT",
    )();
    const cleanupShell = findEffect(
      mocked.effects,
      effectIndex,
      "navigationCache.clear",
    )();
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
    const cleanupFreshness = findEffect(
      mocked.effects,
      effectIndex,
      "NATIVE_REFRESH_EVENT",
    )();

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
    const cleanupIntent = findEffect(
      mocked.layoutEffects,
      layoutEffectIndex,
      "RUNTIME_MAIN_NAVIGATION_INTENT_EVENT",
    )();

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
    const cleanupIntent = findEffect(
      mocked.layoutEffects,
      layoutEffectIndex,
      "RUNTIME_MAIN_NAVIGATION_INTENT_EVENT",
    )();

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
    const cleanupIntent = findEffect(
      mocked.layoutEffects,
      intentLayoutEffectIndex,
      "RUNTIME_MAIN_NAVIGATION_INTENT_EVENT",
    )();

    environment.announce("/dashboard/music");
    expect(environment.pendingTarget.getAttribute("data-sk-nav-pending")).toBe("");

    mocked.pathname = "/dashboard/music";
    mocked.search = "";
    mocked.refIndex = 0;
    const layoutEffectIndex = mocked.layoutEffects.length;
    RuntimeNavigationBridge({ restoreOnOpen: false });
    findEffect(
      mocked.layoutEffects,
      layoutEffectIndex,
      "afterRuntimeNavigationPaint",
    )();
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
