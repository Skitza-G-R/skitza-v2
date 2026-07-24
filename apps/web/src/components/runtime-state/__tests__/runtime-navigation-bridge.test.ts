import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccountPrivateRuntimeState } from "~/lib/runtime-state/account-exit";
import {
  popRuntimeBack,
  readRuntimeNavigationSnapshot,
  type RuntimeIdentity,
} from "~/lib/runtime-state/navigation";
import { MemoryStorage } from "~/lib/runtime-state/__tests__/memory-storage";

type Effect = () => undefined | (() => void);

const mocked = vi.hoisted(() => ({
  effects: [] as Effect[],
  layoutEffects: [] as Effect[],
  pathname: "/dashboard/calendar",
  search: "tab=availability",
  storage: null as MemoryStorage | null,
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
    useRef: <Value>(initialValue: Value) => ({ current: initialValue }),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => mocked.pathname,
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
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

import { RuntimeNavigationBridge } from "../runtime-navigation-bridge";

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
  mocked.search = "tab=availability";
  mocked.storage = new MemoryStorage();
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
