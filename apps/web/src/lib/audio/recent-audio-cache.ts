const CACHE_VERSION = "v1";
const CACHE_NAME_PREFIX = `skitza-recent-audio-${CACHE_VERSION}:`;
const INDEX_KEY_PREFIX = `skitza:recent-audio:${CACHE_VERSION}:`;

export const RECENT_AUDIO_MAX_ENTRIES = 3;
export const RECENT_AUDIO_MAX_BYTES = 64 * 1024 * 1024;
export const RECENT_AUDIO_MAX_ITEM_BYTES = 32 * 1024 * 1024;
export const RECENT_AUDIO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export type AudioCachePolicy = "none" | "public-unlocked";

type RecentAudioIndexEntry = {
  url: string;
  sizeBytes: number;
  lastUsedAt: string;
};

function accountKey(accountId: string): string {
  return encodeURIComponent(accountId);
}

function cacheName(accountId: string): string {
  return `${CACHE_NAME_PREFIX}${accountKey(accountId)}`;
}

function indexKey(accountId: string): string {
  return `${INDEX_KEY_PREFIX}${accountKey(accountId)}`;
}

function parseUrl(rawUrl: string, origin: string): URL | null {
  try {
    return new URL(rawUrl, origin);
  } catch {
    return null;
  }
}

/**
 * The byte-cache boundary is deliberately narrower than the playback
 * boundary. Nothing under /api is eligible, even when a future caller sets
 * the opt-in flag by mistake. A cacheable recording must be explicitly
 * published into the dedicated /media/unlocked namespace. That namespace is
 * a reserved eligibility marker, not a new delivery route: SK-110 adds no
 * endpoint and no current protected/public-capability caller opts into it.
 */
export function isRecentAudioCacheEligible(
  rawUrl: string | null,
  policy: AudioCachePolicy | undefined,
  origin: string,
): boolean {
  if (!rawUrl || policy !== "public-unlocked") return false;
  const url = parseUrl(rawUrl, origin);
  if (!url || url.origin !== origin) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.search || url.hash) return false;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  const lower = pathname.toLowerCase();
  if (!lower.startsWith("/media/unlocked/")) return false;
  if (
    lower.includes("..") ||
    lower.includes("/producers/") ||
    lower.includes("/tracks/") ||
    lower.includes("/api/audio/") ||
    lower.includes("presign") ||
    lower.includes("signature") ||
    lower.includes("x-amz-")
  ) {
    return false;
  }
  return true;
}

/**
 * Account-scoped restoration may remember a protected same-origin route
 * because the server re-authorizes it on every request. It never remembers
 * query-bearing public capabilities, signed URLs, direct object paths or
 * cross-origin locations.
 */
export function isAudioUrlSafeToRestore(rawUrl: string | null, origin: string): boolean {
  if (!rawUrl) return false;
  const url = parseUrl(rawUrl, origin);
  if (!url || url.origin !== origin) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.search || url.hash) return false;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  const lower = pathname.toLowerCase();
  if (
    lower.includes("..") ||
    lower.includes("/producers/") ||
    lower.includes("/tracks/") ||
    lower.includes("/r2/") ||
    lower.includes("presign") ||
    lower.includes("signature") ||
    lower.includes("x-amz-")
  ) {
    return false;
  }
  if (lower.startsWith("/api/audio/public/")) return false;
  return lower.startsWith("/api/audio/stream/") || lower.startsWith("/media/unlocked/");
}

function readIndex(accountId: string): RecentAudioIndexEntry[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(indexKey(accountId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is RecentAudioIndexEntry => {
      if (typeof value !== "object" || value === null) return false;
      const item = value as Record<string, unknown>;
      return (
        typeof item.url === "string" &&
        typeof item.sizeBytes === "number" &&
        Number.isSafeInteger(item.sizeBytes) &&
        item.sizeBytes >= 0 &&
        typeof item.lastUsedAt === "string" &&
        Number.isFinite(new Date(item.lastUsedAt).getTime())
      );
    });
  } catch {
    return [];
  }
}

function writeIndex(accountId: string, entries: readonly RecentAudioIndexEntry[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(indexKey(accountId), JSON.stringify(entries));
}

function requestFor(url: string): Request {
  return new Request(url, { credentials: "same-origin" });
}

async function enforceLimits(
  accountId: string,
  cache: Cache,
  entries: RecentAudioIndexEntry[],
): Promise<RecentAudioIndexEntry[]> {
  let quotaLimit = 0;
  try {
    const estimate = await navigator.storage.estimate();
    if (estimate.quota && Number.isFinite(estimate.quota)) {
      quotaLimit = Math.floor(estimate.quota * 0.2);
    }
  } catch {
    // Unknown quota means no durable byte budget, so retain nothing.
  }
  const byteLimit = Math.min(RECENT_AUDIO_MAX_BYTES, 250 * 1024 * 1024, quotaLimit);
  const now = Date.now();
  const sorted = [...entries].sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
  let keptBytes = 0;
  const kept: RecentAudioIndexEntry[] = [];
  for (const item of sorted) {
    if (
      now - new Date(item.lastUsedAt).getTime() > RECENT_AUDIO_MAX_AGE_MS ||
      kept.length >= RECENT_AUDIO_MAX_ENTRIES ||
      keptBytes + item.sizeBytes > byteLimit
    ) {
      await cache.delete(requestFor(item.url));
      continue;
    }
    kept.push(item);
    keptBytes += item.sizeBytes;
  }
  writeIndex(accountId, kept);
  return kept;
}

export async function cacheRecentAudio(
  accountId: string,
  rawUrl: string,
  policy: AudioCachePolicy | undefined,
  origin: string,
  signal?: AbortSignal,
): Promise<void> {
  if (
    signal?.aborted ||
    typeof caches === "undefined" ||
    !isRecentAudioCacheEligible(rawUrl, policy, origin)
  ) {
    return;
  }
  const absoluteUrl = new URL(rawUrl, origin).toString();
  try {
    const response = await fetch(absoluteUrl, {
      credentials: "same-origin",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) return;
    if (!response.ok || response.status !== 200) return;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("audio/")) return;
    const contentLength = Number(response.headers.get("content-length"));
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > RECENT_AUDIO_MAX_ITEM_BYTES
    ) {
      return;
    }

    const cache = await caches.open(cacheName(accountId));
    if (signal?.aborted) return;
    await cache.put(requestFor(absoluteUrl), response);
    if (signal?.aborted) {
      await cache.delete(requestFor(absoluteUrl));
      return;
    }
    const now = new Date().toISOString();
    const entries = readIndex(accountId).filter((item) => item.url !== absoluteUrl);
    entries.push({ url: absoluteUrl, sizeBytes: contentLength, lastUsedAt: now });
    await enforceLimits(accountId, cache, entries);
    if (signal?.aborted) {
      await cache.delete(requestFor(absoluteUrl));
      writeIndex(
        accountId,
        readIndex(accountId).filter((item) => item.url !== absoluteUrl),
      );
    }
  } catch {
    // Recent audio is an optional acceleration. Playback always keeps the
    // canonical network URL as its source of truth.
  }
}

export async function readRecentAudio(
  accountId: string,
  rawUrl: string,
  policy: AudioCachePolicy | undefined,
  origin: string,
): Promise<Response | null> {
  if (typeof caches === "undefined" || !isRecentAudioCacheEligible(rawUrl, policy, origin)) {
    return null;
  }
  const absoluteUrl = new URL(rawUrl, origin).toString();
  try {
    const cache = await caches.open(cacheName(accountId));
    const response = await cache.match(requestFor(absoluteUrl));
    if (!response) return null;
    const now = new Date().toISOString();
    const entries = readIndex(accountId);
    const current = entries.find((item) => item.url === absoluteUrl);
    if (!current || Date.now() - new Date(current.lastUsedAt).getTime() > RECENT_AUDIO_MAX_AGE_MS) {
      await cache.delete(requestFor(absoluteUrl));
      writeIndex(
        accountId,
        entries.filter((item) => item.url !== absoluteUrl),
      );
      return null;
    }
    writeIndex(accountId, [
      ...entries.filter((item) => item.url !== absoluteUrl),
      { ...current, lastUsedAt: now },
    ]);
    return response;
  } catch {
    return null;
  }
}

export async function clearRecentAudioForAccount(accountId: string): Promise<void> {
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
}
