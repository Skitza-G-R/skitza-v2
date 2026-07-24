import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(),
  createStore: vi.fn(),
  unsubscribePushSubscription: vi.fn(),
}));

vi.mock("@skitza/db", () => ({
  createDb: mocks.createDb,
}));

vi.mock("~/server/push/config", () => ({
  webPushConfig: vi.fn(() => null),
}));

vi.mock("~/server/push/subscription-service", () => ({
  currentPushCategories: vi.fn(),
  InvalidPushSubscriptionError: class InvalidPushSubscriptionError extends Error {},
  PushEndpointOwnershipError: class PushEndpointOwnershipError extends Error {},
  registerPushSubscription: vi.fn(),
  unsubscribePushSubscription: mocks.unsubscribePushSubscription,
}));

vi.mock("~/server/push/store", () => {
  function DrizzlePushSubscriptionStore(db: unknown) {
    mocks.createStore(db);
  }
  return { DrizzlePushSubscriptionStore };
});

import { pushRouter } from "./push";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("push.unsubscribe", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://push-router.test/local";
    mocks.createDb.mockReset().mockReturnValue({});
    mocks.createStore.mockReset();
    mocks.unsubscribePushSubscription.mockReset();
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it.each([true, false])("returns the owned-row removal result when it is %s", async (removed) => {
    mocks.unsubscribePushSubscription.mockResolvedValue(removed);
    const caller = pushRouter.createCaller({ userId: "user_push_owner" });

    await expect(
      caller.unsubscribe({ endpoint: "https://push.example.test/device" }),
    ).resolves.toEqual({ removed });

    expect(mocks.unsubscribePushSubscription).toHaveBeenCalledWith(
      expect.anything(),
      "user_push_owner",
      "https://push.example.test/device",
    );
  });
});
