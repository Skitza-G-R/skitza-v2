import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test doubles ────────────────────────────────────────────────────
// Project Room mutations:
//   - createTrackFromUpload  — replaces title-first form
//   - addVersionFromUpload   — drop-on-row → new version
//   - setVersionStatus       — bilateral 'draft'|'revisit'|'final'
//   - addRangeComment        — Pibox-style range comments
//   - resolveComment / unresolveComment
//
// Each mutation is a thin wrapper around existing logic + the new R2
// multipart-init bridge. The R2 client is mocked at the module level so
// we don't make real network calls.

const PRODUCER_ID = "producer-uuid-1";
const PROJECT_ID = "00000000-0000-0000-0000-000000000a01";
const TRACK_ID = "00000000-0000-0000-0000-000000000b01";
const VERSION_ID = "00000000-0000-0000-0000-000000000c01";
const COMMENT_ID = "00000000-0000-0000-0000-000000000d01";

const {
  projectsMarker,
  producersMarker,
  projectTracksMarker,
  trackVersionsMarker,
  trackCommentsMarker,
  producerSelectQueue,
  projectSelectQueue,
  projectTracksSelectQueue,
  trackVersionsSelectQueue,
  trackCommentsSelectQueue,
  projectTracksInsertSpy,
  trackVersionsInsertSpy,
  trackCommentsInsertSpy,
  trackVersionsUpdateSpy,
  trackCommentsUpdateSpy,
  projectTracksUpdateMock,
  trackVersionsUpdateMock,
  trackCommentsUpdateMock,
  resetCallCounts,
  dbMock,
} = vi.hoisted(() => {
  const projectsMarker: Record<string, unknown> = { __table: "projects" };
  projectsMarker.id = { __column: "projects.id" };
  projectsMarker.producerId = { __column: "projects.producer_id" };

  const producersMarker = { __table: "producers" };
  const projectTracksMarker: Record<string, unknown> = {
    __table: "project_tracks",
  };
  projectTracksMarker.projectId = { __column: "project_tracks.project_id" };
  projectTracksMarker.id = { __column: "project_tracks.id" };
  projectTracksMarker.position = { __column: "project_tracks.position" };

  const trackVersionsMarker: Record<string, unknown> = {
    __table: "track_versions",
  };
  trackVersionsMarker.trackId = { __column: "track_versions.track_id" };
  trackVersionsMarker.id = { __column: "track_versions.id" };

  const trackCommentsMarker: Record<string, unknown> = {
    __table: "track_comments",
  };
  trackCommentsMarker.versionId = { __column: "track_comments.version_id" };
  trackCommentsMarker.id = { __column: "track_comments.id" };

  type Row = Record<string, unknown>;
  const producerSelectQueue: Row[][] = [];
  const projectSelectQueue: Row[][] = [];
  const projectTracksSelectQueue: Row[][] = [];
  const trackVersionsSelectQueue: Row[][] = [];
  const trackCommentsSelectQueue: Row[][] = [];

  const projectTracksInsertSpy = vi.fn<(payload: Row) => void>();
  const trackVersionsInsertSpy = vi.fn<(payload: Row) => void>();
  const trackCommentsInsertSpy = vi.fn<(payload: Row) => void>();
  const trackVersionsUpdateSpy = vi.fn<(payload: Row) => void>();
  const trackCommentsUpdateSpy = vi.fn<(payload: Row) => void>();
  const projectTracksUpdateMock = vi.fn<() => Promise<void>>();
  const trackVersionsUpdateMock = vi.fn<() => Promise<void>>();
  const trackCommentsUpdateMock = vi.fn<() => Promise<void>>();

  const callCounts = { projectTracks: 0 };
  const resetCallCounts = () => {
    callCounts.projectTracks = 0;
  };

  function shift<T>(q: T[][]): T[] {
    return q.shift() ?? [];
  }

  // Generic chain — returns rows at any termination link. Used for
  // the existing-positions SELECT during track creation.
  const chain = (terminal: () => Promise<Row[]>) => {
    let resolved: Promise<Row[]> | null = null;
    const get = () => {
      resolved ??= terminal();
      return resolved;
    };
    type Link = {
      where: () => Link;
      orderBy: () => Link;
      limit: () => Promise<Row[]>;
      innerJoin: () => Link;
      then: Promise<Row[]>["then"];
    };
    const link: Link = {
      where: () => link,
      orderBy: () => link,
      limit: () => get(),
      innerJoin: () => link,
      get then() {
        const p = get();
        return p.then.bind(p);
      },
    };
    return link;
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve(shift(producerSelectQueue)),
            }),
          };
        }
        if (table === projectsMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve(shift(projectSelectQueue)),
            }),
          };
        }
        if (table === projectTracksMarker) {
          callCounts.projectTracks += 1;
          // Two distinct shapes:
          //   1. .where().limit(1)  — ownership lookup by trackId
          //   2. .where().orderBy() — list-positions for new-track insert
          // We dispatch the same FIFO queue to both. orderBy form is
          // chained, .limit form is the direct-promise terminal.
          return {
            where: () => ({
              limit: () => Promise.resolve(shift(projectTracksSelectQueue)),
              orderBy: () =>
                chain(() => Promise.resolve(shift(projectTracksSelectQueue))),
            }),
          };
        }
        if (table === trackVersionsMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve(shift(trackVersionsSelectQueue)),
            }),
          };
        }
        if (table === trackCommentsMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve(shift(trackCommentsSelectQueue)),
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    insert: (table: unknown) => {
      if (table === projectTracksMarker) {
        return {
          values: (payload: Row) => {
            projectTracksInsertSpy(payload);
            return {
              returning: () =>
                Promise.resolve([
                  { id: TRACK_ID, ...payload },
                ]),
            };
          },
        };
      }
      if (table === trackVersionsMarker) {
        return {
          values: (payload: Row) => {
            trackVersionsInsertSpy(payload);
            return {
              returning: () =>
                Promise.resolve([
                  { id: VERSION_ID, ...payload },
                ]),
            };
          },
        };
      }
      if (table === trackCommentsMarker) {
        return {
          values: (payload: Row) => {
            trackCommentsInsertSpy(payload);
            return {
              returning: () =>
                Promise.resolve([
                  { id: COMMENT_ID, ...payload },
                ]),
            };
          },
        };
      }
      throw new Error(`unexpected insert(${String(table)})`);
    },
    update: (table: unknown) => {
      if (table === projectTracksMarker) {
        return {
          set: () => ({ where: () => projectTracksUpdateMock() }),
        };
      }
      if (table === trackVersionsMarker) {
        return {
          set: (payload: Row) => {
            trackVersionsUpdateSpy(payload);
            return { where: () => trackVersionsUpdateMock() };
          },
        };
      }
      if (table === trackCommentsMarker) {
        return {
          set: (payload: Row) => {
            trackCommentsUpdateSpy(payload);
            return { where: () => trackCommentsUpdateMock() };
          },
        };
      }
      // projects update — fire-and-forget for "touch updatedAt" etc.
      return {
        set: () => ({ where: () => Promise.resolve() }),
      };
    },
  };

  return {
    projectsMarker,
    producersMarker,
    projectTracksMarker,
    trackVersionsMarker,
    trackCommentsMarker,
    producerSelectQueue,
    projectSelectQueue,
    projectTracksSelectQueue,
    trackVersionsSelectQueue,
    trackCommentsSelectQueue,
    projectTracksInsertSpy,
    trackVersionsInsertSpy,
    trackCommentsInsertSpy,
    trackVersionsUpdateSpy,
    trackCommentsUpdateSpy,
    projectTracksUpdateMock,
    trackVersionsUpdateMock,
    trackCommentsUpdateMock,
    resetCallCounts,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_1" }),
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  projectTracks: projectTracksMarker,
  trackVersions: trackVersionsMarker,
  trackComments: trackCommentsMarker,
  bookings: { __table: "bookings" },
  invoices: { __table: "invoices" },
  notifications: { __table: "notifications" },
  contracts: { __table: "contracts" },
  clientContacts: { __table: "client_contacts" },
  stripeCustomers: { __table: "stripe_customers" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  not: (cond: unknown) => ({ not: cond }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  gte: (col: unknown, val: unknown) => ({ gte: [col, val] }),
  lte: (col: unknown, val: unknown) => ({ lte: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  isNull: (col: unknown) => ({ isNull: col }),
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  ilike: (col: unknown, val: unknown) => ({ ilike: [col, val] }),
  sql: () => ({ sql: true }),
}));

// R2 — the mutations mint a multipart upload as part of returning
// `presignedMultipartInit`. Mock the R2 client + key builder so the
// test doesn't hit the real R2 endpoint.
vi.mock("~/server/storage/r2", () => ({
  BUCKETS: { audio: "skitza-audio-test", docs: "skitza-docs-test" },
  buildAudioKey: (args: {
    producerId: string;
    trackVersionId: string;
    filename: string;
  }) =>
    `producers/${args.producerId}/tracks/${args.trackVersionId}/${args.filename}`,
  getR2: () => ({
    send: () =>
      Promise.resolve({ UploadId: "test-upload-id-from-mock" }),
  }),
  publicUrl: (_bucket: string, key: string) => `https://r2-test/${key}`,
}));

vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/notifications/emit", () => ({ emitCommentCreated: vi.fn() }));
vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 10 }),
}));

beforeEach(() => {
  producerSelectQueue.length = 0;
  projectSelectQueue.length = 0;
  projectTracksSelectQueue.length = 0;
  trackVersionsSelectQueue.length = 0;
  trackCommentsSelectQueue.length = 0;
  projectTracksInsertSpy.mockReset();
  trackVersionsInsertSpy.mockReset();
  trackCommentsInsertSpy.mockReset();
  trackVersionsUpdateSpy.mockReset();
  trackCommentsUpdateSpy.mockReset();
  projectTracksUpdateMock.mockReset().mockResolvedValue(undefined);
  trackVersionsUpdateMock.mockReset().mockResolvedValue(undefined);
  trackCommentsUpdateMock.mockReset().mockResolvedValue(undefined);
  resetCallCounts();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_1") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

const seedProjectOwned = () => {
  // Producer middleware preflight + project ownership check.
  producerSelectQueue.push([{ id: PRODUCER_ID }]);
  projectSelectQueue.push([{ id: PROJECT_ID, producerId: PRODUCER_ID }]);
};

// ─── createTrackFromUpload ──────────────────────────────────────────
describe("projectRoom.createTrackFromUpload", () => {
  it("derives title from filename — strips .wav extension", async () => {
    seedProjectOwned();
    // Empty existing-positions list for the position calc.
    projectTracksSelectQueue.push([]);

    const caller = await buildCaller();
    await caller.projectRoom.createTrackFromUpload({
      projectId: PROJECT_ID,
      filename: "Summer Song.wav",
      fileSize: 5_000_000,
    });

    const insertCall = projectTracksInsertSpy.mock.calls[0]?.[0];
    expect(insertCall?.title).toBe("Summer Song");
  });

  it("derives title — strips _v2 suffix", async () => {
    seedProjectOwned();
    projectTracksSelectQueue.push([]);
    const caller = await buildCaller();
    await caller.projectRoom.createTrackFromUpload({
      projectId: PROJECT_ID,
      filename: "Track Name_v2.wav",
      fileSize: 5_000_000,
    });
    const insertCall = projectTracksInsertSpy.mock.calls[0]?.[0];
    expect(insertCall?.title).toBe("Track Name");
  });

  it("derives title — strips _master suffix (case-insensitive)", async () => {
    seedProjectOwned();
    projectTracksSelectQueue.push([]);
    const caller = await buildCaller();
    await caller.projectRoom.createTrackFromUpload({
      projectId: PROJECT_ID,
      filename: "Big Beat_MASTER.mp3",
      fileSize: 5_000_000,
    });
    const insertCall = projectTracksInsertSpy.mock.calls[0]?.[0];
    expect(insertCall?.title).toBe("Big Beat");
  });

  it("derives title — strips _mix and _final suffixes", async () => {
    seedProjectOwned();
    projectTracksSelectQueue.push([]);
    const caller = await buildCaller();
    await caller.projectRoom.createTrackFromUpload({
      projectId: PROJECT_ID,
      filename: "Album Track_mix_final.flac",
      fileSize: 5_000_000,
    });
    const insertCall = projectTracksInsertSpy.mock.calls[0]?.[0];
    expect(insertCall?.title).toBe("Album Track");
  });

  it("derives title — strips _demo / _rough", async () => {
    seedProjectOwned();
    projectTracksSelectQueue.push([]);
    const caller = await buildCaller();
    await caller.projectRoom.createTrackFromUpload({
      projectId: PROJECT_ID,
      filename: "Idea_rough_demo.wav",
      fileSize: 5_000_000,
    });
    const insertCall = projectTracksInsertSpy.mock.calls[0]?.[0];
    expect(insertCall?.title).toBe("Idea");
  });

  it("creates V1 track_versions row with audio_url=null and status='draft'", async () => {
    seedProjectOwned();
    projectTracksSelectQueue.push([]);

    const caller = await buildCaller();
    await caller.projectRoom.createTrackFromUpload({
      projectId: PROJECT_ID,
      filename: "Song.wav",
      fileSize: 5_000_000,
    });

    const versionInsert = trackVersionsInsertSpy.mock.calls[0]?.[0];
    expect(versionInsert?.audioUrl).toBeNull();
    expect(versionInsert?.status).toBe("draft");
    expect(versionInsert?.label).toBe("V1");
  });

  it("returns { trackId, versionId, presignedMultipartInit }", async () => {
    seedProjectOwned();
    projectTracksSelectQueue.push([]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.createTrackFromUpload({
      projectId: PROJECT_ID,
      filename: "Song.wav",
      fileSize: 5_000_000,
    });

    expect(result).toEqual({
      trackId: TRACK_ID,
      versionId: VERSION_ID,
      presignedMultipartInit: {
        uploadId: "test-upload-id-from-mock",
        // The key is producer-scoped — see r2.ts buildAudioKey.
        key: expect.stringContaining(`producers/${PRODUCER_ID}/tracks/`) as string,
      },
    });
  });

  it("throws NOT_FOUND when project doesn't belong to caller", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.createTrackFromUpload({
        projectId: PROJECT_ID,
        filename: "x.wav",
        fileSize: 5_000_000,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── addVersionFromUpload ────────────────────────────────────────────
describe("projectRoom.addVersionFromUpload", () => {
  it("creates a new version on existing track and returns init payload", async () => {
    // Producer middleware + ownership walk: project → track → producer.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectTracksSelectQueue.push([
      { id: TRACK_ID, projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([{ id: PROJECT_ID, producerId: PRODUCER_ID }]);
    // Existing-versions list for the V<N+1> label calc.
    trackVersionsSelectQueue.push([{ label: "V1" }]);

    const caller = await buildCaller();
    const result = await caller.projectRoom.addVersionFromUpload({
      trackId: TRACK_ID,
      filename: "song_v2.wav",
      fileSize: 5_000_000,
    });

    const versionInsert = trackVersionsInsertSpy.mock.calls[0]?.[0];
    expect(versionInsert?.audioUrl).toBeNull();
    expect(versionInsert?.status).toBe("draft");

    expect(result).toEqual({
      versionId: VERSION_ID,
      presignedMultipartInit: {
        uploadId: "test-upload-id-from-mock",
        key: expect.stringContaining(`producers/${PRODUCER_ID}/tracks/`) as string,
      },
    });
  });

  it("throws NOT_FOUND when track doesn't exist", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectTracksSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.addVersionFromUpload({
        trackId: TRACK_ID,
        filename: "x.wav",
        fileSize: 5_000_000,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when track belongs to another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    projectTracksSelectQueue.push([
      { id: TRACK_ID, projectId: PROJECT_ID },
    ]);
    // Project belongs to a different producer → the and(producerId) WHERE
    // returns no rows.
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.addVersionFromUpload({
        trackId: TRACK_ID,
        filename: "x.wav",
        fileSize: 5_000_000,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── setVersionStatus ────────────────────────────────────────────────
describe("projectRoom.setVersionStatus", () => {
  // Common ownership walk: version → track → project.
  const seedVersionOwned = () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    trackVersionsSelectQueue.push([
      { id: VERSION_ID, trackId: TRACK_ID },
    ]);
    projectTracksSelectQueue.push([
      { id: TRACK_ID, projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([{ id: PROJECT_ID, producerId: PRODUCER_ID }]);
  };

  it("flips status to 'final' and ALSO sets approvedAt for backward-compat", async () => {
    seedVersionOwned();
    const caller = await buildCaller();
    await caller.projectRoom.setVersionStatus({
      versionId: VERSION_ID,
      status: "final",
    });

    const setPayload = trackVersionsUpdateSpy.mock.calls[0]?.[0];
    expect(setPayload?.status).toBe("final");
    // Backward-compat: existing approvedAt-driven code paths
    // (notification triggers etc.) keep working — we mirror the bilateral
    // pill flip onto approvedAt = NOW() when status flips to 'final'.
    expect(setPayload?.approvedAt).toBeInstanceOf(Date);
  });

  it("clears approvedAt when status flips OFF 'final' (back to draft)", async () => {
    seedVersionOwned();
    const caller = await buildCaller();
    await caller.projectRoom.setVersionStatus({
      versionId: VERSION_ID,
      status: "draft",
    });

    const setPayload = trackVersionsUpdateSpy.mock.calls[0]?.[0];
    expect(setPayload?.status).toBe("draft");
    // Reverting "final → draft" must clear approvedAt or the legacy
    // notification + auto-release behaviors fire on a track that's no
    // longer approved.
    expect(setPayload?.approvedAt).toBeNull();
  });

  it("clears approvedAt when status flips to 'revisit'", async () => {
    seedVersionOwned();
    const caller = await buildCaller();
    await caller.projectRoom.setVersionStatus({
      versionId: VERSION_ID,
      status: "revisit",
    });

    const setPayload = trackVersionsUpdateSpy.mock.calls[0]?.[0];
    expect(setPayload?.status).toBe("revisit");
    expect(setPayload?.approvedAt).toBeNull();
  });

  it("rejects status values outside {draft, revisit, final}", async () => {
    seedVersionOwned();
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.setVersionStatus({
        versionId: VERSION_ID,
        // @ts-expect-error — invalid enum at the input boundary
        status: "delivered",
      }),
    ).rejects.toThrow();
  });

  it("throws NOT_FOUND when version doesn't exist", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    trackVersionsSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.setVersionStatus({
        versionId: VERSION_ID,
        status: "final",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── addRangeComment ────────────────────────────────────────────────
describe("projectRoom.addRangeComment", () => {
  const seedVersionOwned = () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    trackVersionsSelectQueue.push([
      { id: VERSION_ID, trackId: TRACK_ID },
    ]);
    projectTracksSelectQueue.push([
      { id: TRACK_ID, projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([
      {
        id: PROJECT_ID,
        producerId: PRODUCER_ID,
        artistEmail: "maya@example.com",
        artistName: "Maya",
      },
    ]);
  };

  it("creates a comment with timestampMs + endTimestampMs", async () => {
    seedVersionOwned();
    // The producer name lookup runs against producers — seed the row
    // for the displayName projection.
    producerSelectQueue.push([{ displayName: "Studio Z" }]);

    const caller = await buildCaller();
    await caller.projectRoom.addRangeComment({
      versionId: VERSION_ID,
      body: "tighten this section",
      timestampMs: 10000,
      endTimestampMs: 20000,
    });

    const insertCall = trackCommentsInsertSpy.mock.calls[0]?.[0];
    expect(insertCall?.timestampMs).toBe(10000);
    expect(insertCall?.endTimestampMs).toBe(20000);
    expect(insertCall?.fromProducer).toBe(true);
  });

  it("rejects when endTimestampMs <= timestampMs", async () => {
    // Seed only the producer-middleware preflight — input validation
    // happens after middleware in tRPC, so we need a valid producer
    // before the Zod refine fires. Two calls = two preflight rows.
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.addRangeComment({
        versionId: VERSION_ID,
        body: "x",
        timestampMs: 20000,
        endTimestampMs: 20000,
      }),
    ).rejects.toThrow(/end.*must.*be.*greater|greater.*than/i);

    await expect(
      caller.projectRoom.addRangeComment({
        versionId: VERSION_ID,
        body: "x",
        timestampMs: 30000,
        endTimestampMs: 20000,
      }),
    ).rejects.toThrow();
  });

  it("rejects negative timestamps", async () => {
    // Seed producer-middleware preflight so the Zod min(0) refine
    // surfaces (vs. the middleware swallowing the call first).
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.addRangeComment({
        versionId: VERSION_ID,
        body: "x",
        timestampMs: -1,
        endTimestampMs: 1000,
      }),
    ).rejects.toThrow();
  });

  it("throws NOT_FOUND when version doesn't exist", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    trackVersionsSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.addRangeComment({
        versionId: VERSION_ID,
        body: "x",
        timestampMs: 1000,
        endTimestampMs: 2000,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── resolveComment / unresolveComment ──────────────────────────────
describe("projectRoom.resolveComment / unresolveComment", () => {
  const seedCommentOwned = () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    trackCommentsSelectQueue.push([
      { id: COMMENT_ID, versionId: VERSION_ID },
    ]);
    trackVersionsSelectQueue.push([
      { id: VERSION_ID, trackId: TRACK_ID },
    ]);
    projectTracksSelectQueue.push([
      { id: TRACK_ID, projectId: PROJECT_ID },
    ]);
    projectSelectQueue.push([{ id: PROJECT_ID, producerId: PRODUCER_ID }]);
  };

  it("resolveComment sets resolvedAt = NOW()", async () => {
    seedCommentOwned();
    const caller = await buildCaller();
    await caller.projectRoom.resolveComment({ commentId: COMMENT_ID });

    const setPayload = trackCommentsUpdateSpy.mock.calls[0]?.[0];
    expect(setPayload?.resolvedAt).toBeInstanceOf(Date);
  });

  it("unresolveComment clears resolvedAt", async () => {
    seedCommentOwned();
    const caller = await buildCaller();
    await caller.projectRoom.unresolveComment({ commentId: COMMENT_ID });

    const setPayload = trackCommentsUpdateSpy.mock.calls[0]?.[0];
    expect(setPayload?.resolvedAt).toBeNull();
  });

  it("throws NOT_FOUND when comment doesn't exist", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    trackCommentsSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.resolveComment({ commentId: COMMENT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when comment belongs to another producer", async () => {
    producerSelectQueue.push([{ id: PRODUCER_ID }]);
    trackCommentsSelectQueue.push([
      { id: COMMENT_ID, versionId: VERSION_ID },
    ]);
    trackVersionsSelectQueue.push([
      { id: VERSION_ID, trackId: TRACK_ID },
    ]);
    projectTracksSelectQueue.push([
      { id: TRACK_ID, projectId: PROJECT_ID },
    ]);
    // Project ownership SELECT returns nothing → cross-tenant rejection
    // surfaces as NOT_FOUND (not FORBIDDEN — avoid enumeration).
    projectSelectQueue.push([]);
    const caller = await buildCaller();
    await expect(
      caller.projectRoom.resolveComment({ commentId: COMMENT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
