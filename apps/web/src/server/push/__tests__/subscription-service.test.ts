import { describe, expect, it } from "vitest";

import type { PushCategory } from "~/lib/push/categories";

import {
  currentPushCategories,
  InvalidPushSubscriptionError,
  normalizePushEndpoint,
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
const FCM_ENDPOINT = `https://fcm.googleapis.com/wp/${"chrome-token:APA91b".padEnd(96, "x")}`;
const MOZILLA_ENDPOINT = `https://updates.push.services.mozilla.com/wpush/v2/${"firefox-token".padEnd(96, "x")}`;
const APPLE_ENDPOINT = `https://web.push.apple.com/${"safari-token".padEnd(96, "x")}`;
const WNS_ENDPOINT = `https://wns2-am3p.notify.windows.com/w/?token=${encodeURIComponent(
  "edge/channel/token==",
)}`;

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
      input(FCM_ENDPOINT),
      NOW,
    );
    await registerPushSubscription(
      store,
      "user_one",
      input(APPLE_ENDPOINT),
      NOW,
    );

    expect(await store.listByOwner("user_one")).toHaveLength(2);
    expect((await store.listByOwner("user_one")).map((row) => row.categories)).toEqual([[], []]);
  });

  it("updates an owned device but rejects endpoint reuse by another account", async () => {
    const store = new MemoryStore();
    const endpoint = MOZILLA_ENDPOINT;
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
    const endpoint = WNS_ENDPOINT;
    await registerPushSubscription(store, "user_one", input(endpoint, ["booking"]), NOW);

    await expect(unsubscribePushSubscription(store, "user_two", endpoint)).resolves.toBe(false);
    expect(store.rows.has(pushEndpointHash(endpoint))).toBe(true);
    await expect(unsubscribePushSubscription(store, "user_one", endpoint)).resolves.toBe(true);
    await expect(unsubscribePushSubscription(store, "user_one", endpoint)).resolves.toBe(false);
  });

  it("prunes expired devices before registration and preference reads", async () => {
    const store = new MemoryStore();
    const expiredEndpoint = FCM_ENDPOINT;
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

describe("SK-112 push service endpoint allowlist", () => {
  it.each([
    FCM_ENDPOINT,
    `https://fcm.googleapis.com/fcm/send/${"legacy-token:APA91b".padEnd(96, "x")}`,
    `https://fcm.googleapis.com/preprod/wp/${"chromium-token:APA91b".padEnd(96, "x")}`,
    `https://updates.push.services.mozilla.com/wpush/v1/${"firefox-android".padEnd(96, "x")}`,
    MOZILLA_ENDPOINT,
    APPLE_ENDPOINT,
    WNS_ENDPOINT,
  ])("accepts a supported browser push endpoint: %s", (endpoint) => {
    expect(normalizePushEndpoint(endpoint)).toBe(endpoint);
  });

  it("canonicalizes the default HTTPS port", () => {
    const explicitDefaultPort = FCM_ENDPOINT.replace(
      "https://fcm.googleapis.com",
      "https://fcm.googleapis.com:443",
    );

    expect(normalizePushEndpoint(explicitDefaultPort)).toBe(FCM_ENDPOINT);
  });

  it("rejects an untrusted endpoint before persistence", async () => {
    const store = new MemoryStore();

    await expect(
      registerPushSubscription(
        store,
        "user_one",
        input("https://169.254.169.254/latest/meta-data"),
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidPushSubscriptionError);

    expect(store.rows.size).toBe(0);
  });

  it.each([
    "http://fcm.googleapis.com/wp/token",
    "https://user:password@fcm.googleapis.com/wp/token",
    "https://fcm.googleapis.com:8443/wp/token",
    "https://localhost/wp/token",
    "https://127.0.0.1/wp/token",
    "https://[::1]/wp/token",
    "https://10.0.0.1/wp/token",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/computeMetadata/v1",
    "https://fcm.googleapis.com.attacker.example/wp/token",
    "https://evilfcm.googleapis.com/wp/token",
    "https://fcm.googleapis.com./wp/token",
    "https://fcm.googleapis.com/admin/token",
    "https://fcm.googleapis.com/wp/",
    "https://fcm.googleapis.com/wp/token/extra",
    "https://fcm.googleapis.com/wp/token%2Fextra",
    "https://fcm.googleapis.com/wp/token?redirect=https://127.0.0.1",
    "https://fcm.googleapis.com/wp/token?",
    "https://fcm.googleapis.com/wp/token#",
    "https://fcm.google\napis.com/wp/token",
    "https://updates.push.services.mozilla.com.attacker.example/wpush/v2/token",
    "https://updates.push.services.mozilla.com/wpush/v3/token",
    "https://updates.push.services.mozilla.com/wpush/v2/",
    "https://updates.push.services.mozilla.com/wpush/v2/token?redirect=1",
    "https://web.push.apple.com.attacker.example/token",
    "https://evilpush.apple.com/token",
    "https://web.push.apple.com/",
    "https://web.push.apple.com/token/extra",
    "https://web.push.apple.com/token?redirect=1",
    "https://notify.windows.com.attacker.example/w/?token=secret",
    "https://evilnotify.windows.com/w/?token=secret",
    "https://wns2-am3p.notify.windows.com/admin?token=secret",
    "https://wns2-am3p.notify.windows.com/w/",
    "https://wns2-am3p.notify.windows.com/w/?token=",
    "https://wns2-am3p.notify.windows.com/w/?token=secret&redirect=1",
  ])("rejects an untrusted or malformed push endpoint: %s", (endpoint) => {
    expect(() => normalizePushEndpoint(endpoint)).toThrow(InvalidPushSubscriptionError);
  });
});
