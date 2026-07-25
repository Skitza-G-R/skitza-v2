import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

import {
  RUNTIME_VIEW_MAX_AGE_MS,
  buildRuntimeStorageKey,
  runtimeScope,
  type RuntimeRole,
  type RuntimeScope,
  type StorageLike,
  writeRuntimeState,
} from "../../runtime-state/runtime-state";
import { runtimeFiltersForHref } from "../../runtime-state/navigation";

type SavedContext = Readonly<{
  role: RuntimeRole;
  route: string;
  label: string;
  title: string;
  summary: string;
  updatedAt: number;
}>;

type OfflineContext = Readonly<{
  readSavedContext(
    storage: Pick<StorageLike, "length" | "key" | "getItem">,
    locationHref: string,
    now: number,
  ): SavedContext | null;
}>;

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const NOW = 1_800_000_000_000;
let offlineContext: OfflineContext;

function requiredScope(
  userId: string,
  role: RuntimeRole,
  contextId: string,
  href: string,
): RuntimeScope {
  const scope = runtimeScope(userId, role, contextId, href);
  if (!scope) throw new Error(`invalid test scope: ${href}`);
  return scope;
}

function writeNavigation(storage: StorageLike, scope: RuntimeScope, updatedAt = NOW): void {
  expect(
    writeRuntimeState(
      storage,
      scope,
      "runtime.navigation.snapshot",
      {
        href: scope.route,
        scrollTop: 120,
        filters: runtimeFiltersForHref(scope.route, scope.role),
      },
      updatedAt,
    ),
  ).toBe(true);
}

beforeAll(() => {
  const source = readFileSync(
    new URL("../../../../public/pwa/offline-context.js", import.meta.url),
    "utf8",
  );
  const sandbox: Record<string, unknown> = { URL, URLSearchParams };
  runInNewContext(source, sandbox);
  offlineContext = sandbox.SkitzaOfflineContext as OfflineContext;
});

describe("route-aware offline context", () => {
  it("reads a validated producer overview written by the runtime-state store", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user_producer", "producer", "producer_1", "/dashboard");
    writeNavigation(storage, scope, NOW - 2_000);
    expect(
      writeRuntimeState(
        storage,
        scope,
        "producer.overview.safe-view",
        { displayName: "Gili", activeProjects: 3 },
        NOW - 1_000,
      ),
    ).toBe(true);

    expect(offlineContext.readSavedContext(storage, "/dashboard", NOW)).toMatchObject({
      role: "producer",
      route: "/dashboard",
      label: "Home",
      title: "Saved home context.",
      summary: "Saved overview for Gili: 3 active projects.",
      updatedAt: NOW - 1_000,
    });
  });

  it.each([
    {
      href: "/dashboard/clients-projects",
      label: "Clients and projects",
      summary: "Saved workspace: 4 projects · 3 clients · 2 need attention.",
      write(storage: StorageLike, scope: RuntimeScope) {
        return writeRuntimeState(
          storage,
          scope,
          "producer.workspace.safe-view",
          { clientCount: 3, projectCount: 4, needsAttentionCount: 2 },
          NOW - 1_000,
        );
      },
    },
    {
      href: "/dashboard/music",
      label: "Music",
      summary: "Saved music: 8 songs · 4 projects · 1 archived.",
      write(storage: StorageLike, scope: RuntimeScope) {
        return writeRuntimeState(
          storage,
          scope,
          "producer.music.safe-view",
          { projectCount: 4, songCount: 8, archivedSongCount: 1 },
          NOW - 1_000,
        );
      },
    },
    {
      href: "/dashboard/store",
      label: "Store",
      summary: "Saved store: 2 live · 5 products.",
      write(storage: StorageLike, scope: RuntimeScope) {
        return writeRuntimeState(
          storage,
          scope,
          "producer.store.safe-view",
          { productCount: 5, liveProductCount: 2 },
          NOW - 1_000,
        );
      },
    },
    {
      href: "/dashboard/portfolio",
      label: "Portfolio",
      summary: "Saved portfolio: 3 published · 7 available.",
      write(storage: StorageLike, scope: RuntimeScope) {
        return writeRuntimeState(
          storage,
          scope,
          "producer.portfolio.safe-view",
          { publishedCount: 3, availableCount: 7 },
          NOW - 1_000,
        );
      },
    },
  ])("restores the warmed $label safe view without requiring navigation metadata", (entry) => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user_producer", "producer", "producer_1", entry.href);
    expect(entry.write(storage, scope)).toBe(true);

    expect(offlineContext.readSavedContext(storage, entry.href, NOW)).toMatchObject({
      role: "producer",
      route: entry.href,
      label: entry.label,
      summary: entry.summary,
      updatedAt: NOW - 1_000,
    });
  });

  it("fails closed when one account has warmed safe views for multiple producer contexts", () => {
    const storage = new MemoryStorage();
    const first = requiredScope(
      "user_producer",
      "producer",
      "producer_1",
      "/dashboard/music",
    );
    const second = requiredScope(
      "user_producer",
      "producer",
      "producer_2",
      "/dashboard/music",
    );
    expect(
      writeRuntimeState(
        storage,
        first,
        "producer.music.safe-view",
        { projectCount: 1, songCount: 2, archivedSongCount: 0 },
        NOW - 2_000,
      ),
    ).toBe(true);
    expect(
      writeRuntimeState(
        storage,
        second,
        "producer.music.safe-view",
        { projectCount: 3, songCount: 4, archivedSongCount: 1 },
        NOW - 1_000,
      ),
    ).toBe(true);

    expect(offlineContext.readSavedContext(storage, "/dashboard/music", NOW)).toBeNull();
  });

  it("reads a validated artist home without exposing studio details", () => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user_artist", "artist", "artist_1", "/artist");
    writeNavigation(storage, scope);
    expect(
      writeRuntimeState(
        storage,
        scope,
        "artist.home.safe-view",
        {
          firstName: "Noa",
          studios: [
            {
              producerId: "producer_private",
              producerName: "Private Studio",
              producerSlug: "private-studio",
            },
          ],
        },
        NOW,
      ),
    ).toBe(true);

    const saved = offlineContext.readSavedContext(storage, "/artist", NOW);
    expect(saved).toMatchObject({
      role: "artist",
      label: "Home",
      summary: "Saved home for Noa: 1 connected studio.",
    });
    expect(JSON.stringify(saved)).not.toContain("Private Studio");
    expect(JSON.stringify(saved)).not.toContain("producer_private");
  });

  it("uses only the matching route snapshot for a saved nested screen", () => {
    const storage = new MemoryStorage();
    const visitedHref = "/dashboard/music/song_private?tab=versions";
    const scope = requiredScope("user_producer", "producer", "producer_1", visitedHref);
    expect(scope.route).toBe("/dashboard/music/song_private");
    writeNavigation(storage, scope);

    const saved = offlineContext.readSavedContext(storage, visitedHref, NOW);
    expect(saved).toMatchObject({
      route: "/dashboard/music/song_private",
      label: "Music",
      title: "Saved music context.",
      summary: "This music screen was viewed recently for this account.",
    });
    expect(JSON.stringify(saved)).not.toContain("user_producer");
    expect(JSON.stringify(saved)).not.toContain("producer_1");
  });

  it.each([
    "/dashboard/payments/payout_1",
    "/artist/sessions/session_1",
    "/dashboard/invented",
    "/listen/public-token",
    "/sign-in",
  ])("never restores protected transactional or public route %s", (href) => {
    const storage = new MemoryStorage();
    const scope = requiredScope("user_producer", "producer", "producer_1", "/dashboard");
    writeNavigation(storage, scope);

    expect(offlineContext.readSavedContext(storage, href, NOW)).toBeNull();
  });

  it("fails closed when storage contains runtime envelopes for multiple users", () => {
    const storage = new MemoryStorage();
    const first = requiredScope("user_one", "producer", "producer_1", "/dashboard");
    const second = requiredScope("user_two", "artist", "artist_1", "/artist");
    writeNavigation(storage, first);
    writeNavigation(storage, second);

    expect(offlineContext.readSavedContext(storage, "/dashboard", NOW)).toBeNull();
  });

  it("rejects forged, expired, and future navigation envelopes", () => {
    const scope = requiredScope("user_one", "producer", "producer_1", "/dashboard");

    const forged = new MemoryStorage();
    writeNavigation(forged, scope);
    const key = buildRuntimeStorageKey(scope, "runtime.navigation.snapshot");
    const envelope = JSON.parse(forged.getItem(key) ?? "{}") as {
      scope: { route: string };
    };
    envelope.scope.route = "/dashboard/music";
    forged.setItem(key, JSON.stringify(envelope));
    expect(offlineContext.readSavedContext(forged, "/dashboard", NOW)).toBeNull();

    const expired = new MemoryStorage();
    writeNavigation(expired, scope, NOW - RUNTIME_VIEW_MAX_AGE_MS - 1);
    expect(offlineContext.readSavedContext(expired, "/dashboard", NOW)).toBeNull();

    const future = new MemoryStorage();
    writeNavigation(future, scope, NOW + 60_001);
    expect(offlineContext.readSavedContext(future, "/dashboard", NOW)).toBeNull();
  });

  it("rejects public routes before reading account storage", () => {
    const inaccessibleStorage = {
      get length(): number {
        throw new Error("storage must not be read");
      },
      key(): string | null {
        throw new Error("storage must not be read");
      },
      getItem(): string | null {
        throw new Error("storage must not be read");
      },
    };

    expect(
      offlineContext.readSavedContext(inaccessibleStorage, "/listen/public-token", NOW),
    ).toBeNull();
  });
});

describe("offline boundary copy", () => {
  const source = readFileSync(new URL("../../../../public/offline.html", import.meta.url), "utf8");

  it("describes scoped saved context accurately and renders it as text", () => {
    expect(source).toContain('src="/pwa/offline-context.js"');
    expect(source).toMatch(/Saved account\s+context remains isolated on this device/);
    expect(source).not.toContain("Your private work stays out of offline storage");
    expect(source).toContain('getElementById("saved-context-summary").textContent');
    expect(source).not.toContain("innerHTML");
  });
});
