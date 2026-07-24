import { beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => undefined | (() => void);

const mocked = vi.hoisted(() => ({
  effects: [] as Effect[],
  layoutEffects: [] as Effect[],
  readRuntimeNavigationSnapshot: vi.fn(),
  recordRuntimeNavigation: vi.fn(),
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
  usePathname: () => "/dashboard/calendar",
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams("tab=availability"),
}));

vi.mock("~/lib/runtime-state/navigation", () => ({
  popRuntimeBack: vi.fn(),
  readRuntimeNavigationSnapshot: mocked.readRuntimeNavigationSnapshot,
  readRuntimeResumeHref: vi.fn(),
  recordRuntimeNavigation: mocked.recordRuntimeNavigation,
}));

vi.mock("~/lib/runtime-state/runtime-state", () => ({
  normalizeRuntimeHref: (href: string) => href,
}));

vi.mock("../runtime-state-provider", () => ({
  useRuntimeState: () => ({
    identity: {
      userId: "producer-user",
      role: "producer",
      contextId: "producer-id",
    },
    privateStateAccessAllowed: true,
    storage: {},
  }),
}));

import { RuntimeNavigationBridge } from "../runtime-navigation-bridge";

beforeEach(() => {
  mocked.effects.length = 0;
  mocked.layoutEffects.length = 0;
  mocked.readRuntimeNavigationSnapshot.mockReset().mockReturnValue(null);
  mocked.recordRuntimeNavigation.mockReset().mockReturnValue(true);
});

describe("RuntimeNavigationBridge scroll persistence", () => {
  it("does not overwrite the previous route after the shared scroll container resets", () => {
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

    RuntimeNavigationBridge({ restoreOnOpen: false });
    mocked.layoutEffects[0]?.();
    const cleanup = mocked.effects[0]?.();

    main.scrollTop = 900;
    main.dispatchEvent(new Event("scroll"));
    const frame = animation.scheduledFrame;
    if (frame) frame(0);
    expect(mocked.recordRuntimeNavigation.mock.calls.at(-1)?.[3]).toBe(900);

    // The persistent shell reuses this element for Music before the old route
    // effect cleans up. Cleanup must keep Availability's last observed value.
    main.scrollTop = 0;
    main.scrollHeight = main.clientHeight;
    if (typeof cleanup === "function") cleanup();

    expect(mocked.recordRuntimeNavigation.mock.calls.at(-1)?.[3]).toBe(900);
  });
});
