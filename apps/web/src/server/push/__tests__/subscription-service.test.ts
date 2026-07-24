import { describe, expect, it } from "vitest";

import type { PushCategory } from "~/lib/push/categories";

import {
  currentPushCategories,
  PushEndpointOwnershipError,
  pushEndpointHash,
  registerPushSubscription,
  unsubscribePushSubscription,
  type OwnedSubscriptionClaim,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "../subscription-service";

class MemoryStore implements PushSubscriptionStore {
  readonly rows = new Map<string, StoredPushSubscription>();
  private nextId = 1;

  claimOwned(input: OwnedSubscriptionClaim): Promise<StoredPushSubscription> {
    const existing = this.rows.get(input.endpointHash);
    if (existing && existing.clerkUserId !== input.clerkUserId) {
      return Promise.reject(new PushEndpointOwnershipError());
    }
    const row: StoredPushSubscription = {
      id: existing?.id ?? `subscription-${String(this.nextId++)}`,
      clerkUserId: input.clerkUserId,
      endpoint: input.endpoint,
      endpointHash: input.endpointHash,
      p256dh: input.p256dh,
      auth: input.auth,
      categories: input.categories,
      expiresAt: input.expiresAt,
    };
    this.rows.set(input.endpointHash, row);
    return Promise.resolve(row);
  }

  findByEndpointHash(endpointHash: string): Promise<StoredPushSubscription | null> {
    return Promise.resolve(this.rows.get(endpointHash) ?? null);
  }

  listByOwner(clerkUserId: string): Promise<readonly StoredPushSubscription[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.clerkUserId === clerkUserId),
    );
  }

  deleteOwnedByHash(clerkUserId: string, endpointHash: string): Promise<boolean> {
    const row = this.rows.get(endpointHash);
    if (!row || row.clerkUserId !== clerkUserId) return Promise.resolve(false);
    return Promise.resolve(this.rows.delete(endpointHash));
  }

  deleteOwnedById(clerkUserId: string, id: string): Promise<boolean> {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.clerkUserId === clerkUserId && candidate.id === id,
    );
    return Promise.resolve(row ? this.rows.delete(row.endpointHash) : false);
  }

  deleteExpiredForOwner(clerkUserId: string, now: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.clerkUserId === clerkUserId && row.expiresAt !== null && row.expiresAt <= now) {
        this.rows.delete(row.endpointHash);
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

const P256DH = "p".repeat(64);
const AUTH = "a".repeat(24);
const NOW = new Date("2026-07-24T12:00:00.000Z");

function input(
  endpoint: string,
  categories: PushCategory[] = [],
  expirationTime: number | null = null,
) {
  return { endpoint, p256dh: P256DH, auth: AUTH, categories, expirationTime };
}

describe("SK-112 push subscription ownership", () => {
  it("allows several devices for one account and defaults each device off", async () => {
    const store = new MemoryStore();
    await registerPushSubscription(
      store,
      "user_one",
      input("https://push.example.test/device-a"),
      NOW,
    );
    await registerPushSubscription(
      store,
      "user_one",
      input("https://push.example.test/device-b"),
      NOW,
    );

    expect(await store.listByOwner("user_one")).toHaveLength(2);
    expect((await store.listByOwner("user_one")).map((row) => row.categories)).toEqual([[], []]);
  });

  it("updates an owned device but rejects endpoint reuse by another account", async () => {
    const store = new MemoryStore();
    const endpoint = "https://push.example.test/shared";
    await registerPushSubscription(store, "user_one", input(endpoint, ["booking"]), NOW);
    await registerPushSubscription(
      store,
      "user_one",
      input(endpoint, ["comment", "comment"] as PushCategory[]),
      NOW,
    );

    await expect(
      registerPushSubscription(store, "user_two", input(endpoint, ["payment"]), NOW),
    ).rejects.toBeInstanceOf(PushEndpointOwnershipError);
    expect(await currentPushCategories(store, "user_one", endpoint, NOW)).toEqual(["comment"]);
    expect(await currentPushCategories(store, "user_two", endpoint, NOW)).toEqual([]);
  });

  it("makes unsubscribe idempotent and unable to delete another user's device", async () => {
    const store = new MemoryStore();
    const endpoint = "https://push.example.test/owned";
    await registerPushSubscription(store, "user_one", input(endpoint, ["booking"]), NOW);

    await expect(unsubscribePushSubscription(store, "user_two", endpoint)).resolves.toBe(false);
    expect(store.rows.has(pushEndpointHash(endpoint))).toBe(true);
    await expect(unsubscribePushSubscription(store, "user_one", endpoint)).resolves.toBe(true);
    await expect(unsubscribePushSubscription(store, "user_one", endpoint)).resolves.toBe(false);
  });

  it("prunes expired devices before registration and preference reads", async () => {
    const store = new MemoryStore();
    const expiredEndpoint = "https://push.example.test/expired";
    store.rows.set(pushEndpointHash(expiredEndpoint), {
      id: "expired",
      clerkUserId: "user_one",
      endpoint: expiredEndpoint,
      endpointHash: pushEndpointHash(expiredEndpoint),
      p256dh: P256DH,
      auth: AUTH,
      categories: ["booking"],
      expiresAt: new Date("2026-07-24T11:59:59.000Z"),
    });

    expect(await currentPushCategories(store, "user_one", expiredEndpoint, NOW)).toEqual([]);
    expect(store.rows.size).toBe(0);
  });
});
