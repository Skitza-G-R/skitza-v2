import { describe, expect, it, vi } from "vitest";

import { PUSH_CATEGORIES } from "~/lib/push/categories";
import {
  applicationServerKey,
  enableAllPushCategories,
  type BrowserPushSubscriptionLike,
  type EnableAllAdapter,
  type PushSubscriptionInput,
} from "~/lib/push/enable";

function fakeSubscription(endpoint = "https://push.example/abc"): BrowserPushSubscriptionLike & {
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  return {
    endpoint,
    expirationTime: null,
    toJSON: () => ({ keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

function fakeAdapter(overrides: Partial<EnableAllAdapter> = {}): EnableAllAdapter {
  return {
    permission: () => "default",
    requestPermission: () => Promise.resolve("granted"),
    subscription: () => Promise.resolve(null),
    subscribe: () => Promise.resolve(fakeSubscription()),
    save: (input) => Promise.resolve({ ok: true, categories: [...input.categories] }),
    resume: () => Promise.resolve(true),
    boundaryGeneration: () => 1,
    boundaryAllows: () => true,
    ...overrides,
  };
}

describe("enableAllPushCategories", () => {
  it("subscribes once and saves every category in a single call", async () => {
    const save = vi.fn((input: PushSubscriptionInput) =>
      Promise.resolve({ ok: true as const, categories: [...input.categories] }),
    );
    const subscription = fakeSubscription();
    const result = await enableAllPushCategories(
      "key",
      fakeAdapter({ subscribe: () => Promise.resolve(subscription), save }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.categories).toEqual([...PUSH_CATEGORIES]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      endpoint: subscription.endpoint,
      categories: [...PUSH_CATEGORIES],
    });
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("stops with a permission result when the browser says no", async () => {
    const subscribe = vi.fn();
    const result = await enableAllPushCategories(
      "key",
      fakeAdapter({
        requestPermission: () => Promise.resolve("denied"),
        subscribe: subscribe as unknown as EnableAllAdapter["subscribe"],
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "permission" });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("rolls back a subscription it created when the save fails", async () => {
    const created = fakeSubscription();
    const result = await enableAllPushCategories(
      "key",
      fakeAdapter({
        subscribe: () => Promise.resolve(created),
        save: () => Promise.resolve({ ok: false, error: "Server said no." }),
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "error", message: "Server said no." });
    expect(created.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("never unsubscribes a subscription that already existed", async () => {
    const existing = fakeSubscription("https://push.example/existing");
    const result = await enableAllPushCategories(
      "key",
      fakeAdapter({
        subscription: () => Promise.resolve(existing),
        save: () => Promise.resolve({ ok: false, error: "Server said no." }),
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "error" });
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it("rolls back and reports a boundary when an account exit starts mid-flight", async () => {
    let allowed = true;
    const created = fakeSubscription();
    const result = await enableAllPushCategories(
      "key",
      fakeAdapter({
        subscribe: () => {
          allowed = false;
          return Promise.resolve(created);
        },
        boundaryAllows: () => allowed,
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "boundary" });
    expect(created.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("applicationServerKey", () => {
  it("decodes base64url into bytes", () => {
    // "AQID" is base64url for bytes [1, 2, 3].
    expect(Array.from(applicationServerKey("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(applicationServerKey("_-8"))).toEqual([255, 239]);
  });
});
