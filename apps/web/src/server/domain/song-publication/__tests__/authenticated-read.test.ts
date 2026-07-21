import type { Db } from "@skitza/db";
import { describe, expect, it } from "vitest";

import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import { computeStoredAudioIdentityFingerprint } from "~/server/domain/song-management/service";

import {
  readArtistSongPublicationState,
  readProducerSongPublicationState,
  SongPublicationAuthenticatedReadError,
} from "../authenticated-read";
import type { PublicStoredVersionCandidate } from "../read-model";
import { buildSongPublicPath, createSongPublicToken, hashSongPublicToken } from "../tokens";

const SECRET = "sk98-authenticated-read-secret-long-enough";
const scope = {
  projectId: "11111111-1111-4111-8111-111111111111",
  purchaseId: "22222222-2222-4222-8222-222222222222",
  producerId: "33333333-3333-4333-8333-333333333333",
  clientContactId: "44444444-4444-4444-8444-444444444444",
  trackId: "55555555-5555-4555-8555-555555555555",
  linkId: "66666666-6666-4666-8666-666666666666",
  versionId: "77777777-7777-4777-8777-777777777777",
} as const;
const ARTIST_USER_ID = "user_artist_sk98";

function storedVersion(): PublicStoredVersionCandidate {
  const audioR2Key = `producers/${scope.producerId}/tracks/${scope.versionId}/audio.wav`;
  const audioObjectEtag = "etag-authenticated-read";
  const sizeBytes = 2_048;
  return {
    trackId: scope.trackId,
    purchaseId: scope.purchaseId,
    producerId: scope.producerId,
    id: scope.versionId,
    label: "Final master",
    durationMs: 120_000,
    peaks: [0.2, 0.8],
    uploadedAt: new Date("2026-07-20T10:00:00.000Z"),
    audioUrl: privateVersionStreamPath(scope.versionId),
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
  };
}

class QueuedSelectQuery implements PromiseLike<unknown[]> {
  constructor(
    private readonly rows: unknown[],
    private readonly events: string[],
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
    this.events.push(`row:${mode}`);
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

class QueuedAuthenticatedReadDb {
  private readonly rows: unknown[][];
  readonly events: string[] = [];
  transactions = 0;

  constructor(rows: readonly (readonly unknown[])[]) {
    this.rows = rows.map((value) => [...value]);
  }

  select(): QueuedSelectQuery {
    const rows = this.rows.shift();
    if (!rows) throw new Error("Unexpected authenticated-read select");
    return new QueuedSelectQuery(rows, this.events);
  }

  execute(): Promise<unknown[]> {
    this.events.push("advisory:share");
    return Promise.resolve([]);
  }

  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return work(this as unknown as Db);
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

function coreRows(portfolioPublishedAt: Date | null): unknown[][] {
  return [
    [{ ...scope }],
    [
      {
        id: scope.projectId,
        producerId: scope.producerId,
        clientContactId: scope.clientContactId,
      },
    ],
    [
      {
        id: scope.purchaseId,
        projectId: scope.projectId,
        producerId: scope.producerId,
        clientContactId: scope.clientContactId,
      },
    ],
    [
      {
        id: scope.trackId,
        projectId: scope.projectId,
        purchaseId: scope.purchaseId,
        portfolioPublishedAt,
      },
    ],
  ];
}

function linkRow(tokenVersion: number, disabledAt: Date | null): unknown[] {
  const token = createSongPublicToken(SECRET, { linkId: scope.linkId, tokenVersion });
  return [
    {
      id: scope.linkId,
      tokenVersion,
      tokenHash: hashSongPublicToken(token),
      disabledAt,
    },
  ];
}

describe("authenticated song-publication read locking", () => {
  it("returns the post-lock token generation when reset lands after discovery", async () => {
    const currentToken = createSongPublicToken(SECRET, {
      linkId: scope.linkId,
      tokenVersion: 2,
    });
    const db = new QueuedAuthenticatedReadDb([
      ...coreRows(new Date("2026-07-20T09:00:00.000Z")),
      [storedVersion()],
      linkRow(2, null),
    ]);

    const state = await readProducerSongPublicationState(db.asDb(), {
      producerId: scope.producerId,
      trackId: scope.trackId,
      tokenSecret: SECRET,
    });

    expect(state).toMatchObject({
      tokenVersion: 2,
      publicUrl: buildSongPublicPath(currentToken),
      linkEnabled: true,
      portfolioPublished: true,
    });
    expect(db.transactions).toBe(1);
    expect(db.events).toEqual([
      "advisory:share",
      "advisory:share",
      "row:share",
      "row:share",
      "row:share",
      "row:share",
      "row:share",
    ]);
  });

  it("does not give an artist a URL after disable wins the shared-lock boundary", async () => {
    const db = new QueuedAuthenticatedReadDb([
      ...coreRows(null),
      [
        {
          id: scope.clientContactId,
          producerId: scope.producerId,
          clerkUserId: ARTIST_USER_ID,
          archivedAt: null,
        },
      ],
      [storedVersion()],
      linkRow(3, new Date("2026-07-20T11:00:00.000Z")),
    ]);

    await expect(
      readArtistSongPublicationState(db.asDb(), {
        artistClerkUserId: ARTIST_USER_ID,
        trackId: scope.trackId,
        tokenSecret: SECRET,
      }),
    ).rejects.toEqual(new SongPublicationAuthenticatedReadError("NOT_FOUND"));
    expect(db.events.slice(0, 2)).toEqual(["advisory:share", "advisory:share"]);
    expect(db.events.filter((event) => event === "row:share")).toHaveLength(6);
  });

  it("fails closed for a portfolio marker after deletion leaves no playable audio", async () => {
    const db = new QueuedAuthenticatedReadDb([
      ...coreRows(new Date("2026-07-20T09:00:00.000Z")),
      [],
      [],
    ]);

    const state = await readProducerSongPublicationState(db.asDb(), {
      producerId: scope.producerId,
      trackId: scope.trackId,
      tokenSecret: SECRET,
    });

    expect(state).toMatchObject({
      linkEnabled: false,
      portfolioPublished: false,
      remainingAudioCount: 0,
      publicUrl: null,
    });
  });
});
