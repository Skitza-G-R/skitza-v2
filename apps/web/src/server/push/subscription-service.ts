import { createHash } from "node:crypto";

import { normalizePushCategories, type PushCategory } from "~/lib/push/categories";

export type BrowserPushSubscription = Readonly<{
  endpoint: string;
  p256dh: string;
  auth: string;
  categories: readonly PushCategory[];
  expirationTime: number | null;
}>;

export type StoredPushSubscription = Readonly<{
  id: string;
  clerkUserId: string;
  endpoint: string;
  endpointHash: string;
  p256dh: string;
  auth: string;
  categories: readonly PushCategory[];
  expiresAt: Date | null;
}>;

export type OwnedSubscriptionClaim = Readonly<{
  clerkUserId: string;
  endpoint: string;
  endpointHash: string;
  p256dh: string;
  auth: string;
  categories: readonly PushCategory[];
  expiresAt: Date | null;
  now: Date;
}>;

export interface PushSubscriptionStore {
  claimOwned(input: OwnedSubscriptionClaim): Promise<StoredPushSubscription>;
  findByEndpointHash(endpointHash: string): Promise<StoredPushSubscription | null>;
  listByOwner(clerkUserId: string): Promise<readonly StoredPushSubscription[]>;
  deleteOwnedByHash(clerkUserId: string, endpointHash: string): Promise<boolean>;
  deleteOwnedById(clerkUserId: string, id: string): Promise<boolean>;
  deleteExpiredForOwner(clerkUserId: string, now: Date): Promise<number>;
}

export class PushEndpointOwnershipError extends Error {
  constructor() {
    super("PUSH_ENDPOINT_OWNED_BY_ANOTHER_ACCOUNT");
    this.name = "PushEndpointOwnershipError";
  }
}

export class InvalidPushSubscriptionError extends Error {
  constructor() {
    super("INVALID_PUSH_SUBSCRIPTION");
    this.name = "InvalidPushSubscriptionError";
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function pushEndpointHash(endpoint: string): string {
  return `sha256:${createHash("sha256").update(endpoint, "utf8").digest("hex")}`;
}

export function normalizePushEndpoint(value: string): string {
  if (value.length === 0 || value.length > 2048 || value.includes("\\")) {
    throw new InvalidPushSubscriptionError();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidPushSubscriptionError();
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    throw new InvalidPushSubscriptionError();
  }
  return url.href;
}

function validKey(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max && BASE64URL.test(value);
}

export async function registerPushSubscription(
  store: PushSubscriptionStore,
  clerkUserId: string,
  input: BrowserPushSubscription,
  now = new Date(),
): Promise<StoredPushSubscription> {
  const endpoint = normalizePushEndpoint(input.endpoint);
  if (!validKey(input.p256dh, 32, 256) || !validKey(input.auth, 8, 128)) {
    throw new InvalidPushSubscriptionError();
  }

  const expiresAt = input.expirationTime === null ? null : new Date(input.expirationTime);
  if (expiresAt !== null && (!Number.isFinite(input.expirationTime) || expiresAt <= now)) {
    throw new InvalidPushSubscriptionError();
  }

  await store.deleteExpiredForOwner(clerkUserId, now);
  return store.claimOwned({
    clerkUserId,
    endpoint,
    endpointHash: pushEndpointHash(endpoint),
    p256dh: input.p256dh,
    auth: input.auth,
    categories: normalizePushCategories(input.categories),
    expiresAt,
    now,
  });
}

export async function unsubscribePushSubscription(
  store: PushSubscriptionStore,
  clerkUserId: string,
  endpoint: string,
): Promise<boolean> {
  const normalized = normalizePushEndpoint(endpoint);
  return store.deleteOwnedByHash(clerkUserId, pushEndpointHash(normalized));
}

export async function currentPushCategories(
  store: PushSubscriptionStore,
  clerkUserId: string,
  endpoint: string | null,
  now = new Date(),
): Promise<PushCategory[]> {
  await store.deleteExpiredForOwner(clerkUserId, now);
  if (endpoint === null) return [];

  const normalized = normalizePushEndpoint(endpoint);
  const row = await store.findByEndpointHash(pushEndpointHash(normalized));
  if (!row || row.clerkUserId !== clerkUserId) return [];
  return normalizePushCategories(row.categories);
}
