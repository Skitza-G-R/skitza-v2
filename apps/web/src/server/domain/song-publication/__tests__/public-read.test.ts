import type { Db } from "@skitza/db";
import { describe, expect, it, vi } from "vitest";

import type { AudioObjectRequest } from "~/server/domain/audio-delivery/service";
import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import { computeStoredAudioIdentityFingerprint } from "~/server/domain/song-management/service";

import { createPortfolioAudioCapability } from "../audio-capability";
import {
  deliverPortfolioSongAudio,
  deliverSongLinkAudio,
  listPublicPortfolioSongs,
  readPublicSong,
  SongPublicReadError,
} from "../public-read";
import type { PublicStoredVersionCandidate } from "../read-model";
import { createSongPublicToken, hashSongPublicToken } from "../tokens";

const SECRET = "sk98-public-read-test-secret";
const NOW = new Date("2026-07-20T12:00:00.000Z");
const PORTFOLIO_PUBLISHED_AT = new Date("2026-07-20T10:00:00.000Z");

const scope = {
  projectId: "11111111-1111-4111-8111-111111111111",
  purchaseId: "22222222-2222-4222-8222-222222222222",
  producerId: "33333333-3333-4333-8333-333333333333",
  trackId: "44444444-4444-4444-8444-444444444444",
  linkId: "55555555-5555-4555-8555-555555555555",
} as const;

const OLDER_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const NEWER_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const NEWEST_VERSION_ID = "88888888-8888-4888-8888-888888888888";

function storedVersion(
  id: string,
  uploadedAt: string,
  overrides: Partial<PublicStoredVersionCandidate> = {},
): PublicStoredVersionCandidate {
  const audioR2Key = `producers/${scope.producerId}/tracks/${id}/audio.wav`;
  const audioObjectEtag = `etag-${id}`;
  const sizeBytes = 2_048;
  return {
    trackId: scope.trackId,
    purchaseId: scope.purchaseId,
    producerId: scope.producerId,
    id,
    label: `Mix ${id.slice(0, 4)}`,
    durationMs: 120_000,
    peaks: [0.1, 0.6],
    uploadedAt: new Date(uploadedAt),
    audioUrl: privateVersionStreamPath(id),
    audioR2Key,
    sizeBytes,
    audioObjectEtag,
    audioIdentityFingerprint: computeStoredAudioIdentityFingerprint({
      key: audioR2Key,
      objectEtag: audioObjectEtag,
      sizeBytes,
    }),
    audioDeletedAt: null,
    pendingAudioR2Key: null,
    pendingAudioUploadId: null,
    pendingAudioInitiationDigest: null,
    pendingAudioCompletionToken: null,
    pendingAudioSizeBytes: null,
    pendingAudioStartedAt: null,
    pendingAudioCreateAttemptedAt: null,
    pendingAudioCompleteAttemptedAt: null,
    pendingAudioPartUrlsExpireAt: null,
    pendingAudioCancelRequestedAt: null,
    pendingAudioCleanupEtag: null,
    ...overrides,
  };
}

class QueuedSelectQuery implements PromiseLike<unknown[]> {
  constructor(
    private readonly rows: unknown[],
    private readonly lockModes: string[],
  ) {}

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  for(mode: string): this {
    this.lockModes.push(mode);
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

class QueuedPublicReadDb {
  private readonly selectRows: unknown[][];
  readonly advisoryLockStatements: unknown[] = [];
  readonly rowLockModes: string[] = [];

  constructor(selectRows: readonly (readonly unknown[])[]) {
    this.selectRows = selectRows.map((rows) => [...rows]);
  }

  select(): QueuedSelectQuery {
    const rows = this.selectRows.shift();
    if (!rows) throw new Error("Unexpected public-read select in test double");
    return new QueuedSelectQuery(rows, this.rowLockModes);
  }

  execute(statement: unknown): Promise<unknown[]> {
    this.advisoryLockStatements.push(statement);
    return Promise.resolve([]);
  }

  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    return work(this as unknown as Db);
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

type PortfolioListingTrack = Readonly<{
  projectId: string;
  purchaseId: string;
  producerId: string;
  trackId: string;
  title: string;
  artist: string | null;
  portfolioPublishedAt: Date | null;
}>;

type SqlDetails = Readonly<{
  columns: readonly string[];
  parameters: readonly unknown[];
  text: string;
}>;

function inspectSql(value: unknown): SqlDetails {
  const columns: string[] = [];
  const parameters: unknown[] = [];
  const text: string[] = [];
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    const constructorName = candidate.constructor.name;
    if (constructorName === "StringChunk" && Array.isArray(record.value)) {
      text.push(...record.value.filter((part): part is string => typeof part === "string"));
      return;
    }
    if (constructorName === "Param") {
      parameters.push(record.value);
      return;
    }
    if (typeof record.name === "string" && record.table !== undefined) {
      columns.push(record.name);
      return;
    }
    if (Array.isArray(record.queryChunks)) record.queryChunks.forEach(visit);
  };
  visit(value);
  return { columns, parameters, text: text.join("") };
}

class PortfolioListingQuery implements PromiseLike<unknown[]> {
  private rows: unknown[] = [];

  constructor(
    private readonly kind: "tracks" | "versions",
    private readonly owner: PortfolioListingDb,
  ) {}

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(condition: unknown): this {
    const details = inspectSql(condition);
    if (this.kind === "tracks") {
      const appliesMarkerFilter =
        details.columns.includes("portfolio_published_at") &&
        details.text.toLowerCase().includes(" is not null");
      const appliesProducerFilter = details.parameters.includes(this.owner.producerId);
      this.owner.trackFilterWasApplied = appliesMarkerFilter && appliesProducerFilter;
      this.rows = this.owner.tracks.filter(
        (track) =>
          (!appliesMarkerFilter || track.portfolioPublishedAt !== null) &&
          (!appliesProducerFilter || track.producerId === this.owner.producerId),
      );
      return this;
    }

    const track = this.owner.tracks.find(
      (candidate) =>
        details.parameters.includes(candidate.trackId) &&
        details.parameters.includes(candidate.purchaseId) &&
        details.parameters.includes(candidate.producerId),
    );
    if (!track) throw new Error("Version query did not retain the exact song scope");
    this.owner.versionQueries.push(track.trackId);
    this.rows = [...(this.owner.versionsByTrack.get(track.trackId) ?? [])];
    return this;
  }

  orderBy(): this {
    return this;
  }

  for(lock: string): this {
    if (lock !== "share") throw new Error("Portfolio reads must use shared row locks");
    if (this.kind === "tracks") this.owner.trackShareLocks += 1;
    else this.owner.versionShareLocks += 1;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

class PortfolioListingDb {
  trackFilterWasApplied = false;
  readonly versionQueries: string[] = [];
  transactions = 0;
  trackShareLocks = 0;
  versionShareLocks = 0;

  constructor(
    readonly producerId: string,
    readonly tracks: readonly PortfolioListingTrack[],
    readonly versionsByTrack: ReadonlyMap<string, readonly PublicStoredVersionCandidate[]>,
  ) {}

  select(selection: Record<string, unknown>): PortfolioListingQuery {
    return new PortfolioListingQuery(
      Object.hasOwn(selection, "portfolioPublishedAt") ? "tracks" : "versions",
      this,
    );
  }

  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this.asDb());
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

function listingVersion(
  song: Pick<PortfolioListingTrack, "trackId" | "purchaseId" | "producerId">,
  id: string,
  uploadedAt: string,
  overrides: Partial<PublicStoredVersionCandidate> = {},
): PublicStoredVersionCandidate {
  const audioR2Key = `producers/${song.producerId}/tracks/${id}/audio.wav`;
  const audioObjectEtag = `etag-${id}`;
  const sizeBytes = 4_096;
  return {
    trackId: song.trackId,
    purchaseId: song.purchaseId,
    producerId: song.producerId,
    id,
    label: `Mix ${id.slice(0, 4)}`,
    durationMs: 125_000,
    peaks: [0.2, 0.8],
    uploadedAt: new Date(uploadedAt),
    audioUrl: privateVersionStreamPath(id),
    audioR2Key,
    sizeBytes,
    audioObjectEtag,
    audioIdentityFingerprint: computeStoredAudioIdentityFingerprint({
      key: audioR2Key,
      objectEtag: audioObjectEtag,
      sizeBytes,
    }),
    audioDeletedAt: null,
    pendingAudioR2Key: null,
    pendingAudioUploadId: null,
    pendingAudioInitiationDigest: null,
    pendingAudioCompletionToken: null,
    pendingAudioSizeBytes: null,
    pendingAudioStartedAt: null,
    pendingAudioCreateAttemptedAt: null,
    pendingAudioCompleteAttemptedAt: null,
    pendingAudioPartUrlsExpireAt: null,
    pendingAudioCancelRequestedAt: null,
    pendingAudioCleanupEtag: null,
    ...overrides,
  };
}

function linkDb(
  versions: readonly PublicStoredVersionCandidate[],
  currentToken: string,
  includeSafeMetadata = false,
): QueuedPublicReadDb {
  const rows: unknown[][] = [
    [scope],
    [{ id: scope.projectId, producerId: scope.producerId }],
    [
      {
        id: scope.purchaseId,
        producerId: scope.producerId,
        projectId: scope.projectId,
      },
    ],
    [{ id: scope.trackId, projectId: scope.projectId, purchaseId: scope.purchaseId }],
    [...versions],
    [
      {
        id: scope.linkId,
        trackId: scope.trackId,
        purchaseId: scope.purchaseId,
        producerId: scope.producerId,
        tokenVersion: 2,
        tokenHash: hashSongPublicToken(currentToken),
        disabledAt: null,
      },
    ],
  ];
  if (includeSafeMetadata) {
    rows.push([
      {
        title: "Glass Houses",
        artist: "Maya",
        displayName: "North Room",
        brand: null,
      },
    ]);
  }
  return new QueuedPublicReadDb(rows);
}

function portfolioDb(
  versions: readonly PublicStoredVersionCandidate[],
  portfolioPublishedAt = PORTFOLIO_PUBLISHED_AT,
): QueuedPublicReadDb {
  return new QueuedPublicReadDb([
    [scope],
    [{ id: scope.projectId, producerId: scope.producerId }],
    [
      {
        id: scope.purchaseId,
        producerId: scope.producerId,
        projectId: scope.projectId,
      },
    ],
    [{ id: scope.trackId, projectId: scope.projectId, purchaseId: scope.purchaseId }],
    [...versions],
    [{ portfolioPublishedAt }],
  ]);
}

function sqlText(value: unknown): string {
  const fragments: string[] = [];
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (candidate.constructor.name === "StringChunk" && Array.isArray(record.value)) {
      fragments.push(...record.value.filter((part): part is string => typeof part === "string"));
      return;
    }
    if (Array.isArray(record.queryChunks)) record.queryChunks.forEach(visit);
  };
  visit(value);
  return fragments.join("");
}

describe("public song reads and audio delivery", () => {
  it("invalidates the old page and audio token immediately after reset", async () => {
    const oldToken = createSongPublicToken(SECRET, { linkId: scope.linkId, tokenVersion: 1 });
    const currentToken = createSongPublicToken(SECRET, { linkId: scope.linkId, tokenVersion: 2 });
    const version = storedVersion(OLDER_VERSION_ID, "2026-07-18T10:00:00.000Z");

    await expect(
      readPublicSong(linkDb([version], currentToken, true).asDb(), {
        secret: SECRET,
        token: oldToken,
      }),
    ).rejects.toBeInstanceOf(SongPublicReadError);

    const staleOpen = vi.fn((request: AudioObjectRequest) => Promise.resolve(request));
    await expect(
      deliverSongLinkAudio(
        linkDb([version], currentToken).asDb(),
        { secret: SECRET, token: oldToken, versionId: version.id },
        staleOpen,
      ),
    ).rejects.toBeInstanceOf(SongPublicReadError);
    expect(staleOpen).not.toHaveBeenCalled();

    const currentDb = linkDb([version], currentToken);
    const currentOpen = vi.fn((request: AudioObjectRequest) => Promise.resolve(request));
    await expect(
      deliverSongLinkAudio(
        currentDb.asDb(),
        { secret: SECRET, token: currentToken, versionId: version.id },
        currentOpen,
      ),
    ).resolves.toMatchObject({ key: version.audioR2Key, objectEtag: version.audioObjectEtag });
    expect(currentDb.advisoryLockStatements.map(sqlText)).toEqual([
      expect.stringContaining("pg_advisory_xact_lock_shared"),
      expect.stringContaining("pg_advisory_xact_lock_shared"),
    ]);
  });

  it("shows and delivers the newest canonical stored audio when newer rows are invalid", async () => {
    const currentToken = createSongPublicToken(SECRET, {
      linkId: scope.linkId,
      tokenVersion: 2,
    });
    const older = storedVersion(OLDER_VERSION_ID, "2026-07-18T10:00:00.000Z");
    const invalidKey = storedVersion(NEWER_VERSION_ID, "2026-07-19T10:00:00.000Z", {
      audioR2Key: `producers/${scope.producerId}/tracks/foreign-version/audio.wav`,
    });
    const invalidUrl = storedVersion(NEWEST_VERSION_ID, "2026-07-20T10:00:00.000Z", {
      audioUrl: privateVersionStreamPath(OLDER_VERSION_ID),
    });
    const candidates = [invalidUrl, invalidKey, older];

    const view = await readPublicSong(linkDb(candidates, currentToken, true).asDb(), {
      secret: SECRET,
      token: currentToken,
    });
    expect(view.versions.map((version) => version.id)).toEqual([older.id]);

    const invalidOpen = vi.fn((request: AudioObjectRequest) => Promise.resolve(request));
    await expect(
      deliverSongLinkAudio(
        linkDb(candidates, currentToken).asDb(),
        { secret: SECRET, token: currentToken, versionId: invalidUrl.id },
        invalidOpen,
      ),
    ).rejects.toBeInstanceOf(SongPublicReadError);
    expect(invalidOpen).not.toHaveBeenCalled();

    const linkOpen = vi.fn((request: AudioObjectRequest) => Promise.resolve(request));
    await expect(
      deliverSongLinkAudio(
        linkDb(candidates, currentToken).asDb(),
        { secret: SECRET, token: currentToken, versionId: older.id },
        linkOpen,
      ),
    ).resolves.toMatchObject({ key: older.audioR2Key });

    const capability = createPortfolioAudioCapability(
      SECRET,
      {
        producerId: scope.producerId,
        trackId: scope.trackId,
        versionId: older.id,
        portfolioPublishedAtEpochMs: PORTFOLIO_PUBLISHED_AT.getTime(),
      },
      NOW,
    );
    const portfolioOpen = vi.fn((request: AudioObjectRequest) => Promise.resolve(request));
    await expect(
      deliverPortfolioSongAudio(
        portfolioDb(candidates).asDb(),
        { secret: SECRET, capability, versionId: older.id, now: NOW },
        portfolioOpen,
      ),
    ).resolves.toMatchObject({ key: older.audioR2Key });
  });

  it("rejects stale and foreign portfolio capabilities without opening storage", async () => {
    const older = storedVersion(OLDER_VERSION_ID, "2026-07-18T10:00:00.000Z");
    const newer = storedVersion(NEWER_VERSION_ID, "2026-07-20T10:00:00.000Z");
    const staleCapability = createPortfolioAudioCapability(
      SECRET,
      {
        producerId: scope.producerId,
        trackId: scope.trackId,
        versionId: older.id,
        portfolioPublishedAtEpochMs: PORTFOLIO_PUBLISHED_AT.getTime(),
      },
      NOW,
    );
    const open = vi.fn((request: AudioObjectRequest) => Promise.resolve(request));
    await expect(
      deliverPortfolioSongAudio(
        portfolioDb([newer, older]).asDb(),
        { secret: SECRET, capability: staleCapability, versionId: older.id, now: NOW },
        open,
      ),
    ).rejects.toBeInstanceOf(SongPublicReadError);

    const foreignCapability = createPortfolioAudioCapability(
      SECRET,
      {
        producerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        trackId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        versionId: older.id,
        portfolioPublishedAtEpochMs: PORTFOLIO_PUBLISHED_AT.getTime(),
      },
      NOW,
    );
    await expect(
      deliverPortfolioSongAudio(
        new QueuedPublicReadDb([[]]).asDb(),
        { secret: SECRET, capability: foreignCapability, versionId: older.id, now: NOW },
        open,
      ),
    ).rejects.toBeInstanceOf(SongPublicReadError);
    expect(open).not.toHaveBeenCalled();
  });

  it("lists only marked songs with canonical audio and selects each newest canonical version", async () => {
    const unmarked: PortfolioListingTrack = {
      ...scope,
      trackId: "99999999-9999-4999-8999-999999999999",
      title: "Private draft",
      artist: "Maya",
      portfolioPublishedAt: null,
    };
    const noAudio: PortfolioListingTrack = {
      ...scope,
      trackId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "No stored audio",
      artist: null,
      portfolioPublishedAt: new Date("2026-07-20T09:00:00.000Z"),
    };
    const noncanonical: PortfolioListingTrack = {
      ...scope,
      trackId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Invalid audio",
      artist: null,
      portfolioPublishedAt: new Date("2026-07-20T09:30:00.000Z"),
    };
    const publicSong: PortfolioListingTrack = {
      ...scope,
      trackId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Glass Houses",
      artist: "Maya",
      portfolioPublishedAt: PORTFOLIO_PUBLISHED_AT,
    };
    const privateVersion = listingVersion(
      unmarked,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "2026-07-20T10:00:00.000Z",
    );
    const invalidVersion = listingVersion(
      noncanonical,
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "2026-07-20T10:00:00.000Z",
      { audioUrl: privateVersionStreamPath(OLDER_VERSION_ID) },
    );
    const older = listingVersion(
      publicSong,
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "2026-07-18T10:00:00.000Z",
    );
    const newest = listingVersion(
      publicSong,
      "12121212-1212-4212-8212-121212121212",
      "2026-07-20T10:00:00.000Z",
    );
    const database = new PortfolioListingDb(
      scope.producerId,
      [unmarked, noAudio, noncanonical, publicSong],
      new Map([
        [unmarked.trackId, [privateVersion]],
        [noAudio.trackId, []],
        [noncanonical.trackId, [invalidVersion]],
        [publicSong.trackId, [older, newest]],
      ]),
    );

    const songs = await listPublicPortfolioSongs(database.asDb(), {
      producerId: scope.producerId,
      secret: SECRET,
      limit: 10,
    });

    expect(database.trackFilterWasApplied).toBe(true);
    expect(database.transactions).toBe(1);
    expect(database.trackShareLocks).toBe(1);
    expect(database.versionShareLocks).toBe(3);
    expect(database.versionQueries).not.toContain(unmarked.trackId);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: publicSong.trackId,
      title: publicSong.title,
      artist: publicSong.artist,
      durationMs: newest.durationMs,
      peaks: newest.peaks,
      portfolioPublishedAt: publicSong.portfolioPublishedAt,
    });
    expect(songs[0]?.audioUrl).toMatch(
      new RegExp(`^/api/audio/public/song/${newest.id.replaceAll("-", "\\-")}\\?cap=`),
    );
    expect(songs[0]?.audioUrl).not.toContain(older.id);
    expect(songs.map((song) => song.id)).not.toEqual(
      expect.arrayContaining([unmarked.trackId, noAudio.trackId, noncanonical.trackId]),
    );
  });
});
