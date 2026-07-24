const CACHE_VERSION = "v1";
const CACHE_NAME_PREFIX = `skitza-account-audio-${CACHE_VERSION}:`;
const INDEX_KEY_PREFIX = `skitza:account-audio:${CACHE_VERSION}:`;
const CACHE_FAMILY_PREFIX = "skitza-account-audio-";
const INDEX_FAMILY_PREFIX = "skitza:account-audio:";
const LEGACY_CACHE_FAMILY_PREFIX = "skitza-recent-audio-";
const LEGACY_INDEX_FAMILY_PREFIX = "skitza:recent-audio:";
const SYNTHETIC_CACHE_ORIGIN = "https://skitza-account-audio.invalid";
const CACHE_ID_DOMAIN = `skitza-account-audio-${CACHE_VERSION}`;
const PRIVATE_STREAM_PATH =
  /^\/api\/audio\/stream\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const RECENT_AUDIO_MAX_ENTRIES = 10;
export const RECENT_AUDIO_MAX_BYTES = 250 * 1024 * 1024;
export const RECENT_AUDIO_MAX_ITEM_BYTES = RECENT_AUDIO_MAX_BYTES;
export const RECENT_AUDIO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export type AudioCachePolicy = "none" | "account-unlocked";

type RecentAudioIndexEntry = {
  cacheId: string;
  sizeBytes: number;
  cachedAt: string;
  lastUsedAt: string;
};

type RecentAudioIndexRead = {
  entries: RecentAudioIndexEntry[];
  valid: boolean;
};

type EligiblePrivateStream = {
  absoluteUrl: string;
  versionId: string;
};

type RetentionPlan = {
  kept: RecentAudioIndexEntry[];
  evicted: RecentAudioIndexEntry[];
};

type AccountCacheState = {
  generation: number;
  controllers: Set<AbortController>;
  mutationTail: Promise<void>;
};

const accountCacheStates = new Map<string, AccountCacheState>();
let accountIsolationTail = Promise.resolve();

function accountKey(accountId: string): string {
  return encodeURIComponent(accountId);
}

function cacheName(accountId: string): string {
  return `${CACHE_NAME_PREFIX}${accountKey(accountId)}`;
}

function indexKey(accountId: string): string {
  return `${INDEX_KEY_PREFIX}${accountKey(accountId)}`;
}

function stateFor(accountId: string): AccountCacheState {
  let state = accountCacheStates.get(accountId);
  if (!state) {
    state = {
      generation: 0,
      controllers: new Set(),
      mutationTail: Promise.resolve(),
    };
    accountCacheStates.set(accountId, state);
  }
  return state;
}

async function serializeMutation(
  state: AccountCacheState,
  mutation: () => Promise<void>,
): Promise<void> {
  const queued = state.mutationTail.catch(() => undefined).then(mutation);
  state.mutationTail = queued.catch(() => undefined);
  await queued;
}

function parseUrl(rawUrl: string, origin: string): URL | null {
  try {
    return new URL(rawUrl, origin);
  } catch {
    return null;
  }
}

/**
 * Byte caching is an explicit account-private capability. The caller must
 * receive `account-unlocked` from a server-derived read model, and the source
 * must be the existing authenticated, queryless stream route. Public
 * capability URLs, signed URLs, storage keys and cross-origin locations never
 * enter this adapter.
 */
function eligiblePrivateStream(
  rawUrl: string | null,
  policy: AudioCachePolicy | undefined,
  origin: string,
): EligiblePrivateStream | null {
  if (!rawUrl || policy !== "account-unlocked") return null;
  const expectedOrigin = parseUrl(origin, origin)?.origin;
  const url = parseUrl(rawUrl, origin);
  if (!expectedOrigin || !url || url.origin !== expectedOrigin) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const match = PRIVATE_STREAM_PATH.exec(pathname);
  if (!match?.[1]) return null;
  return {
    absoluteUrl: url.toString(),
    versionId: match[1].toLowerCase(),
  };
}

export function isRecentAudioCacheEligible(
  rawUrl: string | null,
  policy: AudioCachePolicy | undefined,
  origin: string,
): boolean {
  return eligiblePrivateStream(rawUrl, policy, origin) !== null;
}

/**
 * Account-scoped restoration may remember this stable protected route because
 * the server re-authorizes every request. It never remembers a public
 * capability, signed URL, direct object path, query, or cross-origin URL.
 */
export function isAudioUrlSafeToRestore(rawUrl: string | null, origin: string): boolean {
  if (!rawUrl) return false;
  const url = parseUrl(rawUrl, origin);
  const expectedOrigin = parseUrl(origin, origin)?.origin;
  if (!expectedOrigin || !url || url.origin !== expectedOrigin) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  try {
    return PRIVATE_STREAM_PATH.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

function readIndex(accountId: string): RecentAudioIndexRead {
  if (typeof localStorage === "undefined") return { entries: [], valid: false };
  try {
    const raw = localStorage.getItem(indexKey(accountId));
    if (!raw) return { entries: [], valid: false };
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { entries: [], valid: false };
    const entries: RecentAudioIndexEntry[] = [];
    const cacheIds = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== "object" || value === null) {
        return { entries: [], valid: false };
      }
      const item = value as Record<string, unknown>;
      const exactKeys =
        Object.keys(item).sort().join(",") ===
        "cacheId,cachedAt,lastUsedAt,sizeBytes";
      if (
        !exactKeys ||
        typeof item.cacheId !== "string" ||
        !/^[0-9a-f]{64}$/.test(item.cacheId) ||
        cacheIds.has(item.cacheId) ||
        typeof item.sizeBytes !== "number" ||
        !Number.isSafeInteger(item.sizeBytes) ||
        item.sizeBytes <= 0 ||
        typeof item.cachedAt !== "string" ||
        !Number.isFinite(new Date(item.cachedAt).getTime()) ||
        typeof item.lastUsedAt !== "string" ||
        !Number.isFinite(new Date(item.lastUsedAt).getTime())
      ) {
        return { entries: [], valid: false };
      }
      cacheIds.add(item.cacheId);
      entries.push({
        cacheId: item.cacheId,
        sizeBytes: item.sizeBytes,
        cachedAt: item.cachedAt,
        lastUsedAt: item.lastUsedAt,
      });
    }
    return { entries, valid: true };
  } catch {
    return { entries: [], valid: false };
  }
}

function writeIndex(accountId: string, entries: readonly RecentAudioIndexEntry[]): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    if (entries.length === 0) {
      localStorage.removeItem(indexKey(accountId));
    } else {
      localStorage.setItem(indexKey(accountId), JSON.stringify(entries));
    }
    return true;
  } catch {
    return false;
  }
}

async function syntheticCacheId(accountId: string, versionId: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(
      `${CACHE_ID_DOMAIN}\u0000${accountId}\u0000${versionId}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}

function requestFor(cacheId: string): Request {
  return new Request(`${SYNTHETIC_CACHE_ORIGIN}/${CACHE_VERSION}/${cacheId}`, {
    credentials: "omit",
  });
}

function cacheIdFromRequest(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const match = /^\/v1\/([0-9a-f]{64})$/.exec(url.pathname);
    if (
      url.origin !== SYNTHETIC_CACHE_ORIGIN ||
      url.search ||
      url.hash ||
      !match?.[1]
    ) {
      return null;
    }
    return match[1];
  } catch {
    return null;
  }
}

async function reconcileCacheIndex(
  cache: Cache,
  accountId: string,
): Promise<RecentAudioIndexEntry[]> {
  const index = readIndex(accountId);
  const requests = await cache.keys();
  if (!index.valid) {
    await Promise.all(requests.map((request) => cache.delete(request)));
    writeIndex(accountId, []);
    return [];
  }
  const indexedIds = new Set(index.entries.map((entry) => entry.cacheId));
  const presentIndexedIds = new Set<string>();
  await Promise.all(
    requests.map(async (request) => {
      const cacheId = cacheIdFromRequest(request);
      if (cacheId && indexedIds.has(cacheId)) {
        presentIndexedIds.add(cacheId);
        return;
      }
      await cache.delete(request);
    }),
  );
  const reconciled = index.entries.filter((entry) =>
    presentIndexedIds.has(entry.cacheId),
  );
  if (reconciled.length !== index.entries.length && !writeIndex(accountId, reconciled)) {
    await deleteEntries(cache, reconciled);
    return [];
  }
  return reconciled;
}

/**
 * Cache Storage is shared by every Clerk identity on this origin. Resolve
 * account isolation before any byte-cache work and on every auth startup:
 * retain only the current account namespace, or retain none when signed out.
 */
export async function enforceRecentAudioAccountIsolation(
  currentAccountId: string | null,
): Promise<void> {
  const operation = accountIsolationTail.catch(() => undefined).then(async () => {
    const staleStates = [...accountCacheStates.entries()].filter(
      ([accountId]) => accountId !== currentAccountId,
    );
    for (const [, state] of staleStates) {
      state.generation += 1;
      for (const controller of state.controllers) controller.abort();
    }
    await Promise.all(staleStates.map(([, state]) => state.mutationTail.catch(() => undefined)));

    if (typeof caches !== "undefined") {
      try {
        const keepName = currentAccountId ? cacheName(currentAccountId) : null;
        const names = await caches.keys();
        await Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(LEGACY_CACHE_FAMILY_PREFIX) ||
                (name.startsWith(CACHE_FAMILY_PREFIX) && name !== keepName),
            )
            .map((name) => caches.delete(name)),
        );
      } catch {
        // Cache isolation remains best effort when CacheStorage is blocked.
      }
    }

    if (typeof localStorage !== "undefined") {
      try {
        const keepKey = currentAccountId ? indexKey(currentAccountId) : null;
        const keys = Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.key(index),
        ).filter((key): key is string => key !== null);
        for (const key of keys) {
          if (
            key.startsWith(LEGACY_INDEX_FAMILY_PREFIX) ||
            (key.startsWith(INDEX_FAMILY_PREFIX) && key !== keepKey)
          ) {
            localStorage.removeItem(key);
          }
        }
      } catch {
        // Account startup and sign-out must survive blocked local storage.
      }
    }

    if (currentAccountId && typeof caches !== "undefined") {
      const state = stateFor(currentAccountId);
      try {
        await serializeMutation(state, async () => {
          const byteLimit = await quotaByteLimit();
          if (byteLimit <= 0) {
            await purgeAccountCacheWithinMutation(currentAccountId, state);
            return;
          }

          const names = await caches.keys();
          if (!names.includes(cacheName(currentAccountId))) {
            writeIndex(currentAccountId, []);
            return;
          }

          const cache = await caches.open(cacheName(currentAccountId));
          const entries = await reconcileCacheIndex(cache, currentAccountId);
          const plan = retentionPlan(entries, byteLimit, Date.now());
          await deleteEntries(cache, plan.evicted);
          if (!writeIndex(currentAccountId, plan.kept)) {
            await deleteEntries(cache, plan.kept);
          }
        });
      } catch {
        // Retention is optional when the browser blocks CacheStorage.
      }
    }
  });
  accountIsolationTail = operation.catch(() => undefined);
  await operation;
}

async function quotaByteLimit(): Promise<number> {
  try {
    const estimate = await navigator.storage.estimate();
    if (!estimate.quota || !Number.isFinite(estimate.quota)) return 0;
    return Math.min(RECENT_AUDIO_MAX_BYTES, Math.floor(estimate.quota * 0.2));
  } catch {
    return 0;
  }
}

function retentionPlan(
  entries: readonly RecentAudioIndexEntry[],
  byteLimit: number,
  now: number,
): RetentionPlan {
  const sorted = entries
    .map((entry, order) => ({ entry, order }))
    .sort(
      (a, b) =>
        new Date(b.entry.lastUsedAt).getTime() - new Date(a.entry.lastUsedAt).getTime() ||
        b.order - a.order,
    )
    .map(({ entry }) => entry);
  let keptBytes = 0;
  const kept: RecentAudioIndexEntry[] = [];
  const evicted: RecentAudioIndexEntry[] = [];
  for (const item of sorted) {
    const cachedAt = new Date(item.cachedAt).getTime();
    if (
      cachedAt > now ||
      now - cachedAt >= RECENT_AUDIO_MAX_AGE_MS ||
      kept.length >= RECENT_AUDIO_MAX_ENTRIES ||
      keptBytes + item.sizeBytes > byteLimit
    ) {
      evicted.push(item);
      continue;
    }
    kept.push(item);
    keptBytes += item.sizeBytes;
  }
  return { kept, evicted };
}

async function deleteEntries(
  cache: Cache,
  entries: readonly RecentAudioIndexEntry[],
): Promise<void> {
  await Promise.all(entries.map((item) => cache.delete(requestFor(item.cacheId))));
}

function workIsCurrent(state: AccountCacheState, generation: number, signal: AbortSignal): boolean {
  return state.generation === generation && !signal.aborted;
}

async function purgeAccountCacheWithinMutation(
  accountId: string,
  state: AccountCacheState,
): Promise<void> {
  state.generation += 1;
  for (const controller of state.controllers) controller.abort();
  try {
    await caches.delete(cacheName(accountId));
  } finally {
    writeIndex(accountId, []);
  }
}

function createWorkController(externalSignal: AbortSignal | undefined): {
  controller: AbortController;
  detach: () => void;
} {
  const controller = new AbortController();
  if (!externalSignal) return { controller, detach: () => undefined };
  const abort = () => {
    controller.abort();
  };
  if (externalSignal.aborted) {
    controller.abort();
    return { controller, detach: () => undefined };
  }
  externalSignal.addEventListener("abort", abort, { once: true });
  return {
    controller,
    detach: () => {
      externalSignal.removeEventListener("abort", abort);
    },
  };
}

export async function cacheRecentAudio(
  accountId: string,
  rawUrl: string,
  policy: AudioCachePolicy | undefined,
  origin: string,
  externalSignal?: AbortSignal,
): Promise<void> {
  const source = eligiblePrivateStream(rawUrl, policy, origin);
  if (typeof caches === "undefined" || !source) return;
  try {
    await enforceRecentAudioAccountIsolation(accountId);
  } catch {
    return;
  }
  const state = stateFor(accountId);
  const generation = state.generation;
  const { controller, detach } = createWorkController(externalSignal);
  state.controllers.add(controller);

  try {
    const cacheId = await syntheticCacheId(accountId, source.versionId);
    if (!cacheId || !workIsCurrent(state, generation, controller.signal)) return;
    const byteLimit = await quotaByteLimit();
    if (!workIsCurrent(state, generation, controller.signal)) return;
    if (byteLimit <= 0) {
      await clearRecentAudioForAccount(accountId);
      return;
    }

    const response = await fetch(source.absoluteUrl, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (
      !response.ok ||
      response.status !== 200 ||
      response.redirected ||
      response.url !== source.absoluteUrl
    ) {
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("audio/")) return;
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength <= 0 ||
      declaredLength > RECENT_AUDIO_MAX_ITEM_BYTES ||
      declaredLength > byteLimit ||
      response.body === null
    ) {
      return;
    }
    if (!workIsCurrent(state, generation, controller.signal)) return;
    // The authenticated same-origin route supplies the trusted finite length.
    // Keep the body streaming into Cache Storage so a useful studio master
    // never needs a second whole-file allocation in the iPhone JS heap.
    const cachedResponse = new Response(response.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(declaredLength),
      },
    });

    await serializeMutation(state, async () => {
      if (!workIsCurrent(state, generation, controller.signal)) return;
      const commitByteLimit = await quotaByteLimit();
      if (!workIsCurrent(state, generation, controller.signal)) return;
      if (commitByteLimit <= 0) {
        await purgeAccountCacheWithinMutation(accountId, state);
        return;
      }
      const cache = await caches.open(cacheName(accountId));
      if (!workIsCurrent(state, generation, controller.signal)) return;
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const candidate: RecentAudioIndexEntry = {
        cacheId,
        sizeBytes: declaredLength,
        cachedAt: timestamp,
        lastUsedAt: timestamp,
      };
      const entries = (await reconcileCacheIndex(cache, accountId)).filter(
        (item) => item.cacheId !== cacheId,
      );
      const plan = retentionPlan([...entries, candidate], commitByteLimit, now);
      await deleteEntries(cache, plan.evicted);
      if (!plan.kept.some((item) => item.cacheId === cacheId)) {
        writeIndex(accountId, plan.kept);
        return;
      }
      await cache.put(requestFor(cacheId), cachedResponse);
      if (!workIsCurrent(state, generation, controller.signal)) {
        await cache.delete(requestFor(cacheId));
        return;
      }
      if (!writeIndex(accountId, plan.kept)) {
        await deleteEntries(cache, plan.kept);
      }
    });
  } catch {
    // Account-private recent audio is an optional acceleration. Playback
    // always keeps the authenticated network route as its source of truth.
  } finally {
    state.controllers.delete(controller);
    detach();
  }
}

export async function readRecentAudio(
  accountId: string,
  rawUrl: string,
  policy: AudioCachePolicy | undefined,
  origin: string,
): Promise<Response | null> {
  const source = eligiblePrivateStream(rawUrl, policy, origin);
  if (typeof caches === "undefined" || !source) return null;
  try {
    await enforceRecentAudioAccountIsolation(accountId);
  } catch {
    return null;
  }
  const state = stateFor(accountId);
  const generation = state.generation;
  const cacheId = await syntheticCacheId(accountId, source.versionId);
  if (!cacheId || state.generation !== generation) return null;
  const byteLimit = await quotaByteLimit();
  if (byteLimit <= 0) {
    try {
      await clearRecentAudioForAccount(accountId);
    } catch {
      // Cache failures must fall back to the authenticated network source.
    }
    return null;
  }
  let hit: Response | null = null;

  try {
    await serializeMutation(state, async () => {
      if (state.generation !== generation) return;
      const commitByteLimit = await quotaByteLimit();
      if (state.generation !== generation) return;
      if (commitByteLimit <= 0) {
        await purgeAccountCacheWithinMutation(accountId, state);
        return;
      }
      const cache = await caches.open(cacheName(accountId));
      if (state.generation !== generation) return;
      const entries = await reconcileCacheIndex(cache, accountId);
      const plan = retentionPlan(entries, commitByteLimit, Date.now());
      await deleteEntries(cache, plan.evicted);
      const current = plan.kept.find((item) => item.cacheId === cacheId);
      if (!current) {
        await cache.delete(requestFor(cacheId));
        writeIndex(accountId, plan.kept);
        return;
      }
      const cacheRequest = requestFor(cacheId);
      const response = await cache.match(cacheRequest);
      if (state.generation !== generation) return;
      const contentType = response?.headers.get("content-type") ?? "";
      const contentLength = response?.headers.get("content-length") ?? "";
      const headerNames = response ? [...response.headers.keys()].sort().join(",") : "";
      if (
        !response ||
        response.status !== 200 ||
        !contentType.toLowerCase().startsWith("audio/") ||
        contentLength !== String(current.sizeBytes) ||
        headerNames !== "content-length,content-type" ||
        (response.url !== "" && response.url !== cacheRequest.url)
      ) {
        await cache.delete(requestFor(cacheId));
        writeIndex(
          accountId,
          plan.kept.filter((item) => item.cacheId !== cacheId),
        );
        return;
      }
      const touched = plan.kept.map((item) =>
        item.cacheId === cacheId ? { ...item, lastUsedAt: new Date().toISOString() } : item,
      );
      if (!writeIndex(accountId, touched)) {
        await deleteEntries(cache, touched);
        return;
      }
      hit = response;
    });
  } catch {
    return null;
  }
  return hit;
}

export async function clearRecentAudioForAccount(accountId: string): Promise<void> {
  const state = stateFor(accountId);
  state.generation += 1;
  for (const controller of state.controllers) controller.abort();
  await serializeMutation(state, async () => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(indexKey(accountId));
      }
    } catch {
      // Still attempt CacheStorage cleanup when local storage is blocked.
    }
    try {
      if (typeof caches !== "undefined") {
        await caches.delete(cacheName(accountId));
      }
    } catch {
      // CacheStorage is optional and account exit must remain available.
    }
  });
}
