import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccountPrivateRuntimeState } from "~/lib/runtime-state/account-exit";
import { MemoryStorage } from "~/lib/runtime-state/__tests__/memory-storage";
import {
  readRuntimeState,
  runtimeScope,
  writeRuntimeState,
  type ProducerStoreProductDraft,
} from "~/lib/runtime-state/runtime-state";

type Effect = () => undefined | (() => void);

const mocked = vi.hoisted(() => ({
  effects: [] as Effect[],
  layoutEffects: [] as Effect[],
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  storage: null as MemoryStorage | null,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: <Value>(callback: Value) => callback,
    useEffect: (effect: Effect) => {
      mocked.effects.push(effect);
    },
    useLayoutEffect: (effect: Effect) => {
      mocked.layoutEffects.push(effect);
    },
    useMemo: <Value>(factory: () => Value) => factory(),
    useRef: <Value>(initialValue: Value) => ({ current: initialValue }),
    useState: <Value>(initialValue: Value | (() => Value)) => {
      const value =
        typeof initialValue === "function"
          ? (initialValue as () => Value)()
          : initialValue;
      const setter = vi.fn();
      mocked.setters.push(setter);
      return [value, setter];
    },
  };
});

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

vi.mock("../online-required-link", () => ({
  useOnlineStatus: () => true,
}));

import {
  useProducerStoreProductDraft,
  useRuntimeCachedView,
} from "../use-runtime-state";

function productDraft(name: string): ProducerStoreProductDraft {
  return {
    open: true,
    mode: "new",
    productId: null,
    currentStep: "details",
    draft: {
      _picked: "production",
      _legacyAgreementLink: false,
      name,
      tagline: "A complete production",
      type: "production",
      price: 2_500,
      currency: "USD",
      sessions: 8,
      unlimitedSessions: false,
      payment: {
        full: true,
        split50: true,
        monthly: false,
        monthlyInstallments: 4,
      },
      includes: ["Mix", "Master"],
      duration: "60 min",
      revisions: 3,
      unlimitedRevisions: false,
      agreementMode: "text",
      agreementText: "Exact terms",
      royalty: {
        masterMode: "none",
        masterPercentage: "",
        compositionMode: "percentage",
        compositionPercentage: "10",
        compositionRole: "composer",
        collectingSociety: "",
        notes: "",
      },
      pricingModel: "flat",
      volumeTiers: [],
    },
  };
}

beforeEach(() => {
  mocked.effects.length = 0;
  mocked.layoutEffects.length = 0;
  mocked.setters.length = 0;
  mocked.storage = new MemoryStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRuntimeCachedView account exit", () => {
  it("does not restore a cleared view or update state from a stale second frame", () => {
    const storage = mocked.storage;
    if (!storage) throw new Error("Expected runtime storage");
    const scope = runtimeScope(
      "producer-user",
      "producer",
      "producer-id",
      "/dashboard",
    );
    if (!scope) throw new Error("Expected runtime scope");
    writeRuntimeState(storage, scope, "producer.overview.safe-view", {
      displayName: "Cached studio",
      activeProjects: 1,
    });

    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const browserWindow = Object.assign(new EventTarget(), {
      requestAnimationFrame(callback: FrameRequestCallback) {
        nextFrameId += 1;
        frames.set(nextFrameId, callback);
        return nextFrameId;
      },
      cancelAnimationFrame(frameId: number) {
        frames.delete(frameId);
      },
    });
    vi.stubGlobal("window", browserWindow);

    useRuntimeCachedView({
      slot: "producer.overview.safe-view",
      route: "/dashboard",
      serverData: {
        displayName: "Fresh server studio",
        activeProjects: 2,
      },
    });

    mocked.layoutEffects[0]?.();
    const removeUpdateListener = mocked.effects[0]?.();
    const cancelReplacement = mocked.effects[1]?.();

    const firstFrame = frames.get(1);
    if (!firstFrame) throw new Error("Expected first replacement frame");
    frames.delete(1);
    firstFrame(0);

    const secondFrame = frames.get(2);
    if (!secondFrame) throw new Error("Expected second replacement frame");
    frames.delete(2);

    const dataSetter = mocked.setters[0];
    const sourceSetter = mocked.setters[1];
    if (!dataSetter || !sourceSetter) throw new Error("Expected cached view setters");
    const dataCallsBeforeClear = dataSetter.mock.calls.length;
    const sourceCallsBeforeClear = sourceSetter.mock.calls.length;

    expect(clearAccountPrivateRuntimeState("producer-user", storage)).toBe(1);
    expect(storage.length).toBe(0);

    secondFrame(16);

    expect(storage.length).toBe(0);
    expect(dataSetter).toHaveBeenCalledTimes(dataCallsBeforeClear);
    expect(sourceSetter).toHaveBeenCalledTimes(sourceCallsBeforeClear);

    if (typeof cancelReplacement === "function") cancelReplacement();
    if (typeof removeUpdateListener === "function") removeUpdateListener();
  });
});

describe("runtime draft account exit", () => {
  it("blocks a stale product-editor save but lets a fresh same-account hook save", () => {
    const storage = mocked.storage;
    if (!storage) throw new Error("Expected runtime storage");
    vi.stubGlobal("window", new EventTarget());

    const scope = runtimeScope(
      "producer-user",
      "producer",
      "producer-id",
      "/dashboard/store",
    );
    if (!scope) throw new Error("Expected runtime scope");

    const staleDraft = useProducerStoreProductDraft();
    expect(staleDraft.save(productDraft("Before sign-out"))).toBe(true);
    expect(storage.length).toBe(1);

    const staleRecordSetter = mocked.setters[0];
    if (!staleRecordSetter) throw new Error("Expected product-draft setter");
    const setterCallsBeforeClear = staleRecordSetter.mock.calls.length;

    expect(clearAccountPrivateRuntimeState("producer-user", storage)).toBe(1);
    expect(storage.length).toBe(0);

    expect(staleDraft.save(productDraft("Stale unmount flush"))).toBe(false);
    expect(storage.length).toBe(0);
    expect(staleRecordSetter).toHaveBeenCalledTimes(setterCallsBeforeClear);

    const freshDraft = useProducerStoreProductDraft();
    expect(freshDraft.save(productDraft("Fresh editor"))).toBe(true);
    expect(
      readRuntimeState(storage, scope, "producer.store.product-draft")?.draft.name,
    ).toBe("Fresh editor");
  });
});
