import { describe, expect, it, vi } from "vitest";

import {
  PushEndpointOwnershipError,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "../subscription-service";
import { webPushConfig } from "../config";
import { deliverPushToUser } from "../delivery";

const USER = "user_push";
const ID = "00000000-0000-4000-8000-000000000112";
const NOW = new Date("2026-07-24T12:00:00.000Z");
const CONFIG = {
  subject: "mailto:push@skitza.app",
  publicKey: "B".repeat(87),
  privateKey: "p".repeat(43),
} as const;

class DeliveryStore implements PushSubscriptionStore {
  readonly rows: StoredPushSubscription[];
  deleted: string[] = [];

  constructor(rows: StoredPushSubscription[]) {
    this.rows = rows;
  }

  claimOwned(): Promise<StoredPushSubscription> {
    return Promise.reject(new PushEndpointOwnershipError());
  }

  findByEndpointHash(): Promise<StoredPushSubscription | null> {
    return Promise.resolve(null);
  }

  listByOwner(clerkUserId: string) {
    return Promise.resolve(this.rows.filter((row) => row.clerkUserId === clerkUserId));
  }

  deleteOwnedByHash(): Promise<boolean> {
    return Promise.resolve(false);
  }

  deleteOwnedById(clerkUserId: string, id: string): Promise<boolean> {
    const row = this.rows.find(
      (candidate) => candidate.clerkUserId === clerkUserId && candidate.id === id,
    );
    if (!row) return Promise.resolve(false);
    this.deleted.push(id);
    return Promise.resolve(true);
  }

  deleteExpiredForOwner(clerkUserId: string, now: Date): Promise<number> {
    const expired = this.rows.filter(
      (row) => row.clerkUserId === clerkUserId && row.expiresAt !== null && row.expiresAt <= now,
    );
    this.deleted.push(...expired.map((row) => row.id));
    return Promise.resolve(expired.length);
  }
}

function row(
  id: string,
  categories: StoredPushSubscription["categories"],
  expiresAt: Date | null = null,
): StoredPushSubscription {
  return {
    id,
    clerkUserId: USER,
    endpoint: `https://push.example.test/${id}`,
    endpointHash: `sha256:${id.padEnd(64, "0").slice(0, 64)}`,
    p256dh: "p".repeat(64),
    auth: "a".repeat(24),
    categories,
    expiresAt,
  };
}

describe("SK-112 Web Push delivery", () => {
  it("sends generic non-PII copy only to devices opting into the real category", async () => {
    const store = new DeliveryStore([
      row("booking-device", ["booking"]),
      row("comment-device", ["comment"]),
    ]);
    const sender = vi.fn().mockResolvedValue({ statusCode: 201 });

    await expect(
      deliverPushToUser(
        store,
        USER,
        {
          category: "booking",
          url: `/dashboard/calendar?booking=${ID}`,
        },
        { config: CONFIG, now: NOW, sender },
      ),
    ).resolves.toEqual({ attempted: 1, delivered: 1, deleted: 0 });

    expect(sender).toHaveBeenCalledTimes(1);
    const payload = String(sender.mock.calls[0]?.[1]);
    expect(JSON.parse(payload)).toEqual({
      version: 1,
      category: "booking",
      title: "Booking update",
      body: "Open Skitza to review the session.",
      url: `/dashboard/calendar?booking=${ID}`,
    });
    expect(payload).not.toMatch(/@|token|endpoint|p256dh|auth/i);
    expect(sender.mock.calls[0]?.[2]).toMatchObject({
      TTL: 3600,
      urgency: "normal",
      contentEncoding: "aes128gcm",
      vapidDetails: CONFIG,
    });
  });

  it("fails closed when VAPID or the exact deep link is invalid", async () => {
    const store = new DeliveryStore([row("device", ["booking"])]);
    const sender = vi.fn();

    await expect(
      deliverPushToUser(
        store,
        USER,
        { category: "booking", url: "https://evil.example/item" },
        { config: CONFIG, now: NOW, sender },
      ),
    ).resolves.toEqual({ attempted: 0, delivered: 0, deleted: 0 });
    await expect(
      deliverPushToUser(
        store,
        USER,
        { category: "booking", url: `/dashboard/calendar?booking=${ID}` },
        { config: null, now: NOW, sender },
      ),
    ).resolves.toEqual({ attempted: 0, delivered: 0, deleted: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  it("deletes expired and upstream-gone endpoints without logging their details", async () => {
    const store = new DeliveryStore([
      row("expired", ["comment"], new Date("2026-07-24T11:59:00.000Z")),
      row("gone", ["comment"]),
    ]);
    const sender = vi.fn().mockRejectedValue({ statusCode: 410, body: "secret" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      deliverPushToUser(
        store,
        USER,
        { category: "comment", url: `/dashboard/music/${ID}` },
        { config: CONFIG, now: NOW, sender },
      ),
    ).resolves.toEqual({ attempted: 1, delivered: 0, deleted: 2 });
    expect(store.deleted).toEqual(["expired", "gone"]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});

describe("SK-112 VAPID configuration", () => {
  it("accepts only complete syntactically valid configuration", () => {
    expect(
      webPushConfig({
        WEB_PUSH_VAPID_SUBJECT: CONFIG.subject,
        WEB_PUSH_VAPID_PUBLIC_KEY: CONFIG.publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: CONFIG.privateKey,
      }),
    ).toEqual(CONFIG);
    expect(webPushConfig({})).toBeNull();
    expect(
      webPushConfig({
        WEB_PUSH_VAPID_SUBJECT: "javascript:alert(1)",
        WEB_PUSH_VAPID_PUBLIC_KEY: CONFIG.publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: CONFIG.privateKey,
      }),
    ).toBeNull();
    expect(
      webPushConfig({
        WEB_PUSH_VAPID_SUBJECT: CONFIG.subject,
        WEB_PUSH_VAPID_PUBLIC_KEY: "not a key",
        WEB_PUSH_VAPID_PRIVATE_KEY: CONFIG.privateKey,
      }),
    ).toBeNull();
  });
});
