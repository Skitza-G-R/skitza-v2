import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: {
    createCaller: () => ({
      push: {
        unsubscribe: mocks.unsubscribe,
      },
    }),
  },
}));

import { unsubscribePushAction } from "./push-actions";

describe("unsubscribePushAction", () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ userId: "user_push_owner" });
    mocks.unsubscribe.mockReset();
  });

  it.each([true, false])("preserves the router removal result when it is %s", async (removed) => {
    mocks.unsubscribe.mockResolvedValue({ removed });

    await expect(
      unsubscribePushAction("https://push.example.test/device"),
    ).resolves.toEqual({
      ok: true,
      removed,
    });

    expect(mocks.unsubscribe).toHaveBeenCalledWith({
      endpoint: "https://push.example.test/device",
    });
  });
});
