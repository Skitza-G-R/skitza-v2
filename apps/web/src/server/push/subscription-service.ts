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
const PUSH_ENDPOINT_TOKEN = "[A-Za-z0-9._~:-]+";
// These are the current provider-issued Web Push route families. Delivery
// performs server-side HTTP, so an arbitrary HTTPS endpoint is never valid.
const FCM_PATH = new RegExp(`^/(?:fcm/send|wp|preprod/wp)/${PUSH_ENDPOINT_TOKEN}$`);
const MOZILLA_PATH = new RegExp(`^/wpush/v[12]/${PUSH_ENDPOINT_TOKEN}$`);
const APPLE_PATH = new RegExp(`^/${PUSH_ENDPOINT_TOKEN}$`);

function hasAsciiControlOrSpace(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

function isProviderSubdomain(hostname: string, domain: string): boolean {
  return hostname.endsWith(`.${domain}`);
}

function isSupportedPushServiceUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  const hasNoQuery = !url.search && !url.href.includes("?");

  if (hostname === "fcm.googleapis.com") {
    return hasNoQuery && FCM_PATH.test(url.pathname);
  }

  if (hostname === "updates.push.services.mozilla.com") {
    return hasNoQuery && MOZILLA_PATH.test(url.pathname);
  }

  if (isProviderSubdomain(hostname, "push.apple.com")) {
    return hasNoQuery && APPLE_PATH.test(url.pathname);
  }

  if (hostname === "notify.windows.com" || isProviderSubdomain(hostname, "notify.windows.com")) {
    const keys = [...url.searchParams.keys()];
    const tokens = url.searchParams.getAll("token");
    return (
      url.pathname === "/w/" &&
      keys.every((key) => key === "token") &&
      keys.length === 1 &&
      tokens.length === 1 &&
      (tokens[0]?.length ?? 0) > 0
    );
  }

  return false;
}

export function pushEndpointHash(endpoint: string): string {
  return `sha256:${createHash("sha256").update(endpoint, "utf8").digest("hex")}`;
}

export function normalizePushEndpoint(value: string): string {
  if (
    value.length === 0 ||
    value.length > 2048 ||
    value.includes("\\") ||
    value.includes("#") ||
    hasAsciiControlOrSpace(value)
  ) {
    throw new InvalidPushSubscriptionError();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidPushSubscriptionError();
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !isSupportedPushServiceUrl(url)
  ) {
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
