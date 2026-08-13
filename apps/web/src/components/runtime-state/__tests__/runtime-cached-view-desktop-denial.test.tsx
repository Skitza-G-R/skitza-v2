// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStorage } from "~/lib/runtime-state/__tests__/memory-storage";
import { runtimeScope, writeRuntimeState } from "~/lib/runtime-state/runtime-state";

const mocked = vi.hoisted(() => ({
  privateStateAccessAllowed: true,
  storage: null as MemoryStorage | null,
}));

vi.mock("../runtime-state-provider", () => ({
  useRuntimeState: () => ({
    identity: {
      userId: "producer-user",
      role: "producer",
      contextId: "producer-studio",
    },
    privateStateAccessAllowed: mocked.privateStateAccessAllowed,
    storage: mocked.storage,
  }),
}));

vi.mock("../online-required-link", () => ({
  useOnlineStatus: () => true,
}));

import { useRuntimeCachedView } from "../use-runtime-state";

beforeEach(() => {
  mocked.privateStateAccessAllowed = true;
  mocked.storage = new MemoryStorage();
});

afterEach(() => {
  cleanup();
});

describe("useRuntimeCachedView desktop validation denial", () => {
  it("drops an already-rendered account view as soon as access is denied", () => {
    const scope = runtimeScope("producer-user", "producer", "producer-studio", "/dashboard");
    if (!scope || !mocked.storage) throw new Error("Expected scoped storage");
    writeRuntimeState(mocked.storage, scope, "producer.overview.safe-view", {
      displayName: "Private cached studio",
      activeProjects: 4,
    });

    const { result, rerender } = renderHook(() =>
      useRuntimeCachedView({
        route: "/dashboard",
        slot: "producer.overview.safe-view",
      }),
    );
    expect(result.current.data?.displayName).toBe("Private cached studio");
    expect(result.current.source).toBe("cache");

    act(() => {
      mocked.privateStateAccessAllowed = false;
      rerender();
    });

    expect(result.current).toEqual({
      data: undefined,
      refreshing: false,
      source: "unseen",
    });
  });
});
