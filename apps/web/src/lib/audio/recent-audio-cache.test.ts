import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECENT_AUDIO_MAX_AGE_MS,
  RECENT_AUDIO_MAX_BYTES,
  RECENT_AUDIO_MAX_ENTRIES,
  RECENT_AUDIO_MAX_ITEM_BYTES,
  cacheRecentAudio,
  clearRecentAudioForAccount,
  enforceRecentAudioAccountIsolation,
  isAudioUrlSafeToRestore,
  isRecentAudioCacheEligible,
  readRecentAudio,
} from "./recent-audio-cache";

const ORIGIN = "https://skitza.test";
const VERSION_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
  "10000000-0000-4000-8000-000000000006",
  "10000000-0000-4000-8000-000000000007",
  "10000000-0000-4000-8000-000000000008",
  "10000000-0000-4000-8000-000000000009",
  "10000000-0000-4000-8000-000000000010",
  "10000000-0000-4000-8000-000000000011",
] as const;

function stream(versionId: string): string {
  return `/api/audio/stream/${versionId}`;
}

class MemoryLocalStorage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class MemoryCache {
  readonly responses = new Map<string, Response>();

  delete(request: Request): Promise<boolean> {
    return Promise.resolve(this.responses.delete(request.url));
  }

  match(request: Request): Promise<Response | undefined> {
    return Promise.resolve(this.responses.get(request.url)?.clone());
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.responses.keys()].map((url) => new Request(url)));
  }

  put(request: Request, response: Response): Promise<void> {
    this.responses.set(request.url, response.clone());
    return Promise.resolve();
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>();

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }

  open(name: string): Promise<MemoryCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.stores.set(name, cache);
    }
    return Promise.resolve(cache);
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()]);
  }

  entriesFor(accountId: string): MemoryCache {
    const suffix = `:${encodeURIComponent(accountId)}`;
    const match = [...this.stores.entries()].find(([name]) => name.endsWith(suffix));
    if (!match) throw new Error(`Missing cache for ${accountId}`);
    return match[1];
  }
}

function audioResponse(sizeBytes: number, declaredLength = sizeBytes): Response {
  return new Response(new Uint8Array(sizeBytes), {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(declaredLength),
      "x-private-storage-key": "must-not-be-cached",
    },
  });
}

function installCacheEnvironment(
  input: {
    quota?: number;
    responseSize?: number;
    fetchImplementation?: typeof fetch;
  } = {},
) {
  const storage = new MemoryLocalStorage();
  const cacheStorage = new MemoryCacheStorage();
  let quota = input.quota;
  let responseSize = input.responseSize ?? 1;
  const fetchImplementation =
    input.fetchImplementation ?? (() => Promise.resolve(audioResponse(responseSize)));
  const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchImplementation(request, init);
    if (response.url === "") {
      Object.defineProperty(response, "url", {
        value: new Request(request).url,
      });
    }
    return response;
  });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("caches", cacheStorage);
  vi.stubGlobal("navigator", {
    storage: {
      estimate: () => Promise.resolve(quota === undefined ? {} : { quota }),
    },
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    storage,
    cacheStorage,
    fetchMock,
    setQuota(next: number | undefined) {
      quota = next;
    },
    setResponseSize(next: number) {
      responseSize = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("account-private recent audio eligibility", () => {
  it("accepts only an explicit account-unlocked private stream", () => {
    const path = stream(VERSION_IDS[0]);
    expect(isRecentAudioCacheEligible(path, "account-unlocked", ORIGIN)).toBe(true);
    expect(isRecentAudioCacheEligible(path, "none", ORIGIN)).toBe(false);
    expect(isRecentAudioCacheEligible(path, undefined, ORIGIN)).toBe(false);
  });

  it.each([
    [`${stream(VERSION_IDS[0])}?token=secret`, "query-bearing private path"],
    [`/api/audio/public/song/${VERSION_IDS[0]}?token=secret`, "public token"],
    [`/api/audio/public/song/${VERSION_IDS[0]}?cap=secret`, "public capability"],
    [`${stream(VERSION_IDS[0])}?X-Amz-Signature=secret`, "signed query"],
    ["/producers/producer/tracks/version/song.wav", "storage key"],
    ["https://bucket.r2.cloudflarestorage.com/song.wav", "direct R2"],
    ["https://audio.example/song.wav", "cross-origin"],
    ["/api/audio/stream/not-a-uuid", "invalid stream identity"],
  ])("denies %s (%s)", (url) => {
    expect(isRecentAudioCacheEligible(url, "account-unlocked", ORIGIN)).toBe(false);
  });

  it("restores only stable re-authorized stream paths", () => {
    expect(isAudioUrlSafeToRestore(stream(VERSION_IDS[0]), ORIGIN)).toBe(true);
    expect(isAudioUrlSafeToRestore(`${stream(VERSION_IDS[0])}?token=secret`, ORIGIN)).toBe(false);
    expect(
      isAudioUrlSafeToRestore(
        `https://bucket.r2.cloudflarestorage.com/${VERSION_IDS[0]}.wav`,
        ORIGIN,
      ),
    ).toBe(false);
  });
});

describe("account-private recent audio behavior", () => {
  it("uses the locked 10-item, 30-day, 250 MB retention envelope", () => {
    expect(RECENT_AUDIO_MAX_ENTRIES).toBe(10);
    expect(RECENT_AUDIO_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(RECENT_AUDIO_MAX_BYTES).toBe(250 * 1024 * 1024);
    expect(RECENT_AUDIO_MAX_ITEM_BYTES).toBe(RECENT_AUDIO_MAX_BYTES);
  });

  it("executes a private stream fill and hit without persisting its source or headers", async () => {
    const accountId = "user_executable";
    const env = installCacheEnvironment({ quota: 1_000_000, responseSize: 4 });
    const source = stream(VERSION_IDS[0]);

    await cacheRecentAudio(accountId, source, "account-unlocked", ORIGIN);
    const hit = await readRecentAudio(accountId, source, "account-unlocked", ORIGIN);

    expect(hit).not.toBeNull();
    await expect(hit?.arrayBuffer()).resolves.toHaveProperty("byteLength", 4);
    expect(env.fetchMock).toHaveBeenCalledWith(
      `${ORIGIN}${source}`,
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    const serializedIndex = [...env.storage.values.values()].join("\n");
    const cachedEntries = [...env.cacheStorage.entriesFor(accountId).responses.entries()];
    expect(serializedIndex).not.toContain(source);
    expect(serializedIndex).not.toContain(VERSION_IDS[0]);
    expect(serializedIndex).not.toContain("token");
    expect(cachedEntries).toHaveLength(1);
    expect(cachedEntries[0]?.[0]).toMatch(
      /^https:\/\/skitza-account-audio\.invalid\/v1\/[0-9a-f]{64}$/,
    );
    expect(cachedEntries[0]?.[0]).not.toContain(VERSION_IDS[0]);
    expect(cachedEntries[0]?.[1].url).not.toContain("/api/audio/");
    expect(cachedEntries[0]?.[1].headers.get("x-private-storage-key")).toBeNull();
  });

  it("streams a useful large master into Cache Storage without a whole-file JS read", async () => {
    const accountId = "user_large_master";
    const declaredLength = 96 * 1024 * 1024;
    const sourceResponse = audioResponse(1, declaredLength);
    const wholeBodyRead = vi
      .spyOn(sourceResponse, "arrayBuffer")
      .mockRejectedValue(new Error("whole-file JS read is forbidden"));
    const env = installCacheEnvironment({
      quota: 1024 * 1024 * 1024,
      fetchImplementation: () => Promise.resolve(sourceResponse),
    });

    await cacheRecentAudio(
      accountId,
      stream(VERSION_IDS[0]),
      "account-unlocked",
      ORIGIN,
    );

    expect(wholeBodyRead).not.toHaveBeenCalled();
    const entries = env.cacheStorage.entriesFor(accountId).responses;
    expect(entries.size).toBe(1);
    expect([...entries.values()][0]?.headers.get("content-length")).toBe(
      String(declaredLength),
    );
    const serializedIndex = [...env.storage.values.values()][0] ?? "[]";
    expect(JSON.parse(serializedIndex)).toEqual([
      expect.objectContaining({ sizeBytes: declaredLength }),
    ]);
  });

  it("refuses a redirected response even when it looks like audio", async () => {
    const redirected = audioResponse(4);
    Object.defineProperty(redirected, "redirected", { value: true });
    const env = installCacheEnvironment({
      quota: 1_000_000,
      fetchImplementation: () => Promise.resolve(redirected),
    });

    await cacheRecentAudio(
      "user_redirect_denied",
      stream(VERSION_IDS[0]),
      "account-unlocked",
      ORIGIN,
    );

    expect(env.cacheStorage.stores.size).toBe(0);
    expect(env.storage.values.size).toBe(0);
  });

  it("refuses a network response that cannot prove its exact final URL", async () => {
    const env = installCacheEnvironment({ quota: 1_000_000, responseSize: 4 });
    vi.stubGlobal("fetch", () => Promise.resolve(audioResponse(4)));

    await cacheRecentAudio(
      "user_empty_final_url_denied",
      stream(VERSION_IDS[0]),
      "account-unlocked",
      ORIGIN,
    );

    expect(env.cacheStorage.stores.size).toBe(0);
    expect(env.storage.values.size).toBe(0);
  });

  it("enforces count LRU and keeps a touched oldest item", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const accountId = "user_count_lru";
    const env = installCacheEnvironment({ quota: 1_000_000, responseSize: 1 });

    for (const versionId of VERSION_IDS.slice(0, RECENT_AUDIO_MAX_ENTRIES)) {
      await cacheRecentAudio(accountId, stream(versionId), "account-unlocked", ORIGIN);
      vi.advanceTimersByTime(1_000);
    }
    await readRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN);
    vi.advanceTimersByTime(1_000);
    await cacheRecentAudio(
      accountId,
      stream(VERSION_IDS[RECENT_AUDIO_MAX_ENTRIES]),
      "account-unlocked",
      ORIGIN,
    );

    expect(env.cacheStorage.entriesFor(accountId).responses.size).toBe(RECENT_AUDIO_MAX_ENTRIES);
    await expect(
      readRecentAudio(accountId, stream(VERSION_IDS[1]), "account-unlocked", ORIGIN),
    ).resolves.toBeNull();
    const retainedIds = [
      VERSION_IDS[0],
      ...VERSION_IDS.slice(2, RECENT_AUDIO_MAX_ENTRIES),
      VERSION_IDS[RECENT_AUDIO_MAX_ENTRIES],
    ];
    for (const versionId of retainedIds) {
      await expect(
        readRecentAudio(accountId, stream(versionId), "account-unlocked", ORIGIN),
      ).resolves.not.toBeNull();
    }
  });

  it("evicts by the 20% quota byte budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const accountId = "user_byte_quota";
    const env = installCacheEnvironment({ quota: 50, responseSize: 6 });

    await cacheRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN);
    vi.advanceTimersByTime(1_000);
    await cacheRecentAudio(accountId, stream(VERSION_IDS[1]), "account-unlocked", ORIGIN);

    expect(env.cacheStorage.entriesFor(accountId).responses.size).toBe(1);
    await expect(
      readRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN),
    ).resolves.toBeNull();
    await expect(
      readRecentAudio(accountId, stream(VERSION_IDS[1]), "account-unlocked", ORIGIN),
    ).resolves.not.toBeNull();
    expect(RECENT_AUDIO_MAX_BYTES).toBeLessThanOrEqual(250 * 1024 * 1024);
  });

  it("uses a hard 30-day expiry that LRU touches cannot extend", async () => {
    vi.useFakeTimers();
    const cachedAt = new Date("2026-06-01T00:00:00.000Z");
    vi.setSystemTime(cachedAt);
    const accountId = "user_hard_expiry";
    const env = installCacheEnvironment({ quota: 1_000_000, responseSize: 2 });
    const source = stream(VERSION_IDS[0]);
    await cacheRecentAudio(accountId, source, "account-unlocked", ORIGIN);

    vi.setSystemTime(new Date(cachedAt.getTime() + RECENT_AUDIO_MAX_AGE_MS - 1_000));
    await expect(
      readRecentAudio(accountId, source, "account-unlocked", ORIGIN),
    ).resolves.not.toBeNull();
    vi.setSystemTime(new Date(cachedAt.getTime() + RECENT_AUDIO_MAX_AGE_MS));
    await expect(
      readRecentAudio(accountId, source, "account-unlocked", ORIGIN),
    ).resolves.toBeNull();
    expect(env.cacheStorage.entriesFor(accountId).responses.size).toBe(0);
  });

  it("retains zero bytes when quota is unknown and removes prior bytes", async () => {
    const accountId = "user_unknown_quota";
    const env = installCacheEnvironment({ quota: 100, responseSize: 4 });
    await cacheRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN);
    expect(env.cacheStorage.entriesFor(accountId).responses.size).toBe(1);

    env.setQuota(undefined);
    await cacheRecentAudio(accountId, stream(VERSION_IDS[1]), "account-unlocked", ORIGIN);

    expect(
      [...env.cacheStorage.stores.keys()].some((name) =>
        name.endsWith(`:${encodeURIComponent(accountId)}`),
      ),
    ).toBe(false);
    expect(env.storage.values.size).toBe(0);
    expect(env.fetchMock).toHaveBeenCalledOnce();
  });

  it("deletes orphan cache bytes when quota is unknown even without a valid index", async () => {
    const accountId = "user_orphan_zero_quota";
    const env = installCacheEnvironment({ quota: 100, responseSize: 4 });
    await cacheRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN);
    expect(env.cacheStorage.entriesFor(accountId).responses.size).toBe(1);
    env.storage.clear();
    env.setQuota(undefined);

    await expect(
      readRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN),
    ).resolves.toBeNull();

    expect(
      [...env.cacheStorage.stores.keys()].some((name) =>
        name.endsWith(`:${encodeURIComponent(accountId)}`),
      ),
    ).toBe(false);
    expect(env.storage.values.size).toBe(0);
  });

  it("removes unindexed synthetic bytes before serving a positive-quota hit", async () => {
    const accountId = "user_orphan_reconcile";
    const env = installCacheEnvironment({ quota: 1_000_000, responseSize: 4 });
    const source = stream(VERSION_IDS[0]);
    await cacheRecentAudio(accountId, source, "account-unlocked", ORIGIN);
    const cache = env.cacheStorage.entriesFor(accountId);
    const orphanUrl = `https://skitza-account-audio.invalid/v1/${"f".repeat(64)}`;
    await cache.put(new Request(orphanUrl), audioResponse(3));
    expect(cache.responses.size).toBe(2);

    await expect(
      readRecentAudio(accountId, source, "account-unlocked", ORIGIN),
    ).resolves.not.toBeNull();

    expect(cache.responses.size).toBe(1);
    expect(cache.responses.has(orphanUrl)).toBe(false);
  });

  it("removes phantom index rows whose exact cache request is missing", async () => {
    const accountId = "user_phantom_reconcile";
    const env = installCacheEnvironment({ quota: 1_000_000, responseSize: 4 });
    await cacheRecentAudio(
      accountId,
      stream(VERSION_IDS[0]),
      "account-unlocked",
      ORIGIN,
    );
    const cache = env.cacheStorage.entriesFor(accountId);
    cache.responses.clear();

    await cacheRecentAudio(
      accountId,
      stream(VERSION_IDS[1]),
      "account-unlocked",
      ORIGIN,
    );

    expect(cache.responses.size).toBe(1);
    const serializedIndex = [...env.storage.values.values()][0] ?? "[]";
    expect(JSON.parse(serializedIndex)).toEqual([
      expect.objectContaining({ sizeBytes: 4 }),
    ]);
  });

  it("fails soft to a network miss when CacheStorage rejects a read", async () => {
    const accountId = "user_cache_read_failure";
    installCacheEnvironment({ quota: 1_000_000, responseSize: 2 });
    vi.stubGlobal("caches", {
      keys: () => Promise.reject(new Error("CacheStorage names unavailable")),
      open: () => Promise.reject(new Error("CacheStorage unavailable")),
      delete: () => Promise.resolve(false),
    });

    await expect(
      readRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN),
    ).resolves.toBeNull();
    await expect(
      cacheRecentAudio(accountId, stream(VERSION_IDS[0]), "account-unlocked", ORIGIN),
    ).resolves.toBeUndefined();
  });

  it("clears the exiting account and aborts an in-flight fill without resurrection", async () => {
    const accountA = "user_clear_a";
    let resolveLateFetch: ((response: Response) => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const lateFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          observedSignal = init?.signal ?? undefined;
          resolveLateFetch = resolve;
        }),
    );
    const env = installCacheEnvironment({
      quota: 1_000_000,
      responseSize: 2,
    });
    vi.stubGlobal("fetch", lateFetch);

    const filling = cacheRecentAudio(accountA, stream(VERSION_IDS[1]), "account-unlocked", ORIGIN);
    await vi.waitFor(() => {
      expect(lateFetch).toHaveBeenCalledOnce();
    });
    const clearing = clearRecentAudioForAccount(accountA);
    expect(observedSignal?.aborted).toBe(true);
    resolveLateFetch?.(audioResponse(2));
    await Promise.all([filling, clearing]);

    await expect(
      readRecentAudio(accountA, stream(VERSION_IDS[1]), "account-unlocked", ORIGIN),
    ).resolves.toBeNull();
    expect(
      [...env.storage.values.keys()].some((key) => key.includes(encodeURIComponent(accountA))),
    ).toBe(false);
  });

  it("cannot resurrect streamed bytes when account clear races Cache Storage put", async () => {
    const accountId = "user_clear_during_put";
    let observedSignal: AbortSignal | undefined;
    let releasePut: (() => void) | undefined;
    let markPutStarted: (() => void) | undefined;
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    const responses = new Map<string, Response>();
    const cache = {
      delete: (request: Request) => Promise.resolve(responses.delete(request.url)),
      keys: () => Promise.resolve([...responses.keys()].map((url) => new Request(url))),
      match: (request: Request) => Promise.resolve(responses.get(request.url)?.clone()),
      put: (request: Request, response: Response) => {
        markPutStarted?.();
        return new Promise<void>((resolve) => {
          releasePut = () => {
            responses.set(request.url, response.clone());
            resolve();
          };
        });
      },
    };
    const env = installCacheEnvironment({
      quota: 1_000_000,
      fetchImplementation: (_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return Promise.resolve(audioResponse(4));
      },
    });
    const deleteNamespace = vi.fn(() => {
      responses.clear();
      return Promise.resolve(true);
    });
    vi.stubGlobal("caches", {
      open: () => Promise.resolve(cache),
      delete: deleteNamespace,
    });

    const filling = cacheRecentAudio(
      accountId,
      stream(VERSION_IDS[0]),
      "account-unlocked",
      ORIGIN,
    );
    await putStarted;
    const clearing = clearRecentAudioForAccount(accountId);
    expect(observedSignal?.aborted).toBe(true);
    releasePut?.();
    await Promise.all([filling, clearing]);

    expect(responses.size).toBe(0);
    expect(env.storage.values.size).toBe(0);
    expect(deleteNamespace).toHaveBeenCalledOnce();
  });

  it("cannot resurrect a late fill after an unknown-quota purge changes generation", async () => {
    const accountId = "user_zero_quota_race";
    let resolveLateFetch: ((response: Response) => void) | undefined;
    let observedSignal: AbortSignal | undefined;
    const lateFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          observedSignal = init?.signal ?? undefined;
          resolveLateFetch = resolve;
        }),
    );
    const env = installCacheEnvironment({
      quota: 1_000_000,
      fetchImplementation: lateFetch,
    });

    const filling = cacheRecentAudio(
      accountId,
      stream(VERSION_IDS[0]),
      "account-unlocked",
      ORIGIN,
    );
    await vi.waitFor(() => {
      expect(lateFetch).toHaveBeenCalledOnce();
    });
    env.setQuota(undefined);
    const purging = readRecentAudio(
      accountId,
      stream(VERSION_IDS[1]),
      "account-unlocked",
      ORIGIN,
    );
    await vi.waitFor(() => {
      expect(observedSignal?.aborted).toBe(true);
    });
    resolveLateFetch?.(audioResponse(4));
    await Promise.all([filling, purging]);

    expect(
      [...env.cacheStorage.stores.keys()].some((name) =>
        name.endsWith(`:${encodeURIComponent(accountId)}`),
      ),
    ).toBe(false);
    expect(env.storage.values.size).toBe(0);
  });

  it("purges non-current cold-start state and all account state when signed out", async () => {
    const currentAccount = "user_cold_current";
    const priorAccount = "user_cold_prior";
    const env = installCacheEnvironment({ quota: 1_000_000, responseSize: 4 });
    await cacheRecentAudio(
      currentAccount,
      stream(VERSION_IDS[0]),
      "account-unlocked",
      ORIGIN,
    );
    const currentName = [...env.cacheStorage.stores.keys()][0];
    if (!currentName) throw new Error("Current account cache was not created");
    const priorName = `skitza-account-audio-v1:${encodeURIComponent(priorAccount)}`;
    const oldVersionName = `skitza-account-audio-v0:${encodeURIComponent(currentAccount)}`;
    const unsafeLegacyName = `skitza-recent-audio-v1:${encodeURIComponent(priorAccount)}`;
    await env.cacheStorage.open(priorName);
    await env.cacheStorage.open(oldVersionName);
    await env.cacheStorage.open(unsafeLegacyName);
    await env.cacheStorage.open("unrelated-runtime-cache");
    env.storage.setItem(
      `skitza:account-audio:v1:${encodeURIComponent(priorAccount)}`,
      "prior-index",
    );
    env.storage.setItem(
      `skitza:account-audio:v0:${encodeURIComponent(currentAccount)}`,
      "old-index",
    );
    env.storage.setItem(
      `skitza:recent-audio:v1:${encodeURIComponent(priorAccount)}`,
      "unsafe-source-index",
    );
    env.storage.setItem("unrelated-local-key", "keep");

    await enforceRecentAudioAccountIsolation(currentAccount);

    expect([...env.cacheStorage.stores.keys()].sort()).toEqual(
      [currentName, "unrelated-runtime-cache"].sort(),
    );
    expect(
      [...env.storage.values.keys()].filter((key) =>
        key.startsWith("skitza:account-audio:"),
      ),
    ).toEqual([`skitza:account-audio:v1:${encodeURIComponent(currentAccount)}`]);
    expect(
      [...env.storage.values.keys()].some((key) =>
        key.startsWith("skitza:recent-audio:"),
      ),
    ).toBe(false);
    expect(env.storage.getItem("unrelated-local-key")).toBe("keep");

    await enforceRecentAudioAccountIsolation(null);

    expect([...env.cacheStorage.stores.keys()]).toEqual(["unrelated-runtime-cache"]);
    expect(
      [...env.storage.values.keys()].some((key) =>
        key.startsWith("skitza:account-audio:"),
      ),
    ).toBe(false);
    expect(env.storage.getItem("unrelated-local-key")).toBe("keep");
  });

  it("applies hard expiry to the kept current namespace during cold-start enforcement", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 6, 24, 12);
    vi.setSystemTime(now);
    const accountId = "user_cold_retention";
    const env = installCacheEnvironment({ quota: 1_000_000 });
    const cacheName = `skitza-account-audio-v1:${encodeURIComponent(accountId)}`;
    const indexKey = `skitza:account-audio:v1:${encodeURIComponent(accountId)}`;
    const expiredCacheId = "a".repeat(64);
    const validCacheId = "b".repeat(64);
    const cache = await env.cacheStorage.open(cacheName);
    await cache.put(
      new Request(`https://skitza-account-audio.invalid/v1/${expiredCacheId}`),
      audioResponse(4),
    );
    await cache.put(
      new Request(`https://skitza-account-audio.invalid/v1/${validCacheId}`),
      audioResponse(4),
    );
    env.storage.setItem(
      indexKey,
      JSON.stringify([
        {
          cacheId: expiredCacheId,
          sizeBytes: 4,
          cachedAt: new Date(now - RECENT_AUDIO_MAX_AGE_MS - 1).toISOString(),
          lastUsedAt: new Date(now).toISOString(),
        },
        {
          cacheId: validCacheId,
          sizeBytes: 4,
          cachedAt: new Date(now - RECENT_AUDIO_MAX_AGE_MS + 1).toISOString(),
          lastUsedAt: new Date(now).toISOString(),
        },
      ]),
    );

    await enforceRecentAudioAccountIsolation(accountId);

    expect([...cache.responses.keys()]).toEqual([
      `https://skitza-account-audio.invalid/v1/${validCacheId}`,
    ]);
    expect(JSON.parse(env.storage.getItem(indexKey) ?? "null")).toEqual([
      expect.objectContaining({ cacheId: validCacheId }),
    ]);
  });
});
