import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  PROJECT_ID,
  PRODUCER_ID,
  TRACK_ID,
  producers,
  projects,
  projectTracks,
  purchases,
  purchaseInstallments,
  trackVersions,
  trackComments,
  transactionMock,
  dbMock,
  whereCalls,
} = vi.hoisted(() => {
  const PRODUCER_ID = "00000000-0000-4000-8000-000000000901";
  const PROJECT_ID = "00000000-0000-4000-8000-000000000902";
  const TRACK_ID = "00000000-0000-4000-8000-000000000903";
  const PURCHASE_ID = "00000000-0000-4000-8000-000000000904";
  const producers = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
  };
  const projects = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    lifecycleStatus: { __column: "projects.lifecycle_status" },
  };
  const projectTracks = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    purchaseId: { __column: "project_tracks.purchase_id" },
    position: { __column: "project_tracks.position" },
    createdAt: { __column: "project_tracks.created_at" },
  };
  const purchases = {
    __table: "purchases",
    id: { __column: "purchases.id" },
    producerId: { __column: "purchases.producer_id" },
    projectId: { __column: "purchases.project_id" },
    lifecycleStatus: { __column: "purchases.lifecycle_status" },
    acceptedAt: { __column: "purchases.accepted_at" },
    commercialEstablishedAt: { __column: "purchases.commercial_established_at" },
    commercialSnapshot: { __column: "purchases.commercial_snapshot" },
  };
  const purchaseInstallments = {
    __table: "purchase_installments",
    id: { __column: "purchase_installments.id" },
    purchaseId: { __column: "purchase_installments.purchase_id" },
    producerId: { __column: "purchase_installments.producer_id" },
    position: { __column: "purchase_installments.position" },
    amountCents: { __column: "purchase_installments.amount_cents" },
    currency: { __column: "purchase_installments.currency" },
    dueAt: { __column: "purchase_installments.due_at" },
    status: { __column: "purchase_installments.status" },
  };
  const trackVersions = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
    producerId: { __column: "track_versions.producer_id" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
    audioUrl: { __column: "track_versions.audio_url" },
    audioDeletedAt: { __column: "track_versions.audio_deleted_at" },
  };
  const trackComments = {
    __table: "track_comments",
    versionId: { __column: "track_comments.version_id" },
    timestampMs: { __column: "track_comments.timestamp_ms" },
  };
  const rowsByTable = new Map<unknown, Record<string, unknown>[]>([
    [
      projects,
      [
        {
          id: PROJECT_ID,
          producerId: PRODUCER_ID,
          lifecycleStatus: "active",
        },
      ],
    ],
    [purchaseInstallments, []],
    [
      projectTracks,
      [
        {
          id: TRACK_ID,
          projectId: PROJECT_ID,
          purchaseId: PURCHASE_ID,
          title: "Owned song",
          artist: null,
          position: 0,
        },
      ],
    ],
    [
      purchases,
      [
        {
          id: PURCHASE_ID,
          producerId: PRODUCER_ID,
          projectId: PROJECT_ID,
          lifecycleStatus: "active",
          acceptedAt: new Date("2026-07-17T10:00:00.000Z"),
          commercialEstablishedAt: new Date("2026-07-17T10:00:00.000Z"),
          commercialSnapshot: { includedSongSpaces: 1 },
        },
      ],
    ],
    [
      trackVersions,
      [
        {
          id: "canceled-newest",
          trackId: TRACK_ID,
          uploadedAt: new Date("2026-07-18T12:00:00.000Z"),
          audioUrl: "https://audio.invalid/deleted.wav",
          audioDeletedAt: new Date("2026-07-18T12:01:00.000Z"),
        },
        {
          id: "visible-older",
          trackId: TRACK_ID,
          uploadedAt: new Date("2026-07-17T12:00:00.000Z"),
          audioUrl: "https://audio.invalid/visible.wav",
          audioDeletedAt: null,
        },
      ],
    ],
    [
      trackComments,
      [
        { id: "hidden-comment", versionId: "canceled-newest", timestampMs: 1 },
        { id: "visible-comment", versionId: "visible-older", timestampMs: 2 },
      ],
    ],
  ]);
  const whereCalls: Array<{ table: unknown; condition: unknown }> = [];

  const snapshotDbMock = {
    select: () => ({
      from: (table: unknown) => {
        const rows = rowsByTable.get(table) ?? [];
        return {
          where: (condition: unknown) => {
            whereCalls.push({ table, condition });
            const selectedRows = rows;
            return {
              limit: () => Promise.resolve(selectedRows),
              orderBy: () => Promise.resolve(selectedRows),
            };
          },
          orderBy: () => Promise.resolve(rows),
        };
      },
    }),
  };
  const transactionMock = vi.fn(
    async (work: (transaction: typeof snapshotDbMock) => Promise<unknown>, config?: unknown) => {
      void config;
      return work(snapshotDbMock);
    },
  );
  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table !== producers) {
          throw new Error("Project-detail reads must use the snapshot transaction");
        }
        return {
          where: () => ({ limit: () => Promise.resolve([{ id: PRODUCER_ID }]) }),
        };
      },
    }),
    transaction: transactionMock,
  };

  return {
    PROJECT_ID,
    PRODUCER_ID,
    TRACK_ID,
    producers,
    projects,
    projectTracks,
    purchases,
    purchaseInstallments,
    trackVersions,
    trackComments,
    transactionMock,
    dbMock,
    whereCalls,
  };
});

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers,
  projects,
  projectTracks,
  purchases,
  purchaseInstallments,
  trackVersions,
  trackComments,
  bookings: { __table: "bookings" },
  and: (...conditions: unknown[]) => ({ conditions }),
  asc: (value: unknown) => value,
  desc: (value: unknown) => value,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  inArray: (left: unknown, right: unknown) => ({ left, right }),
  isNull: (value: unknown) => ({ isNull: value }),
  sql: Object.assign(() => ({ sql: true }), { raw: () => ({ sql: true }) }),
}));

vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.test",
  sendProducerRepliedToCommentEmail: vi.fn(),
}));

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/sk90";
  transactionMock.mockClear();
  whereCalls.length = 0;
});

describe("project.detail deleted-audio history", () => {
  it("keeps tombstoned versions and comments while removing their playback URL", async () => {
    const { projectRouter } = await import("../project");
    const caller = projectRouter.createCaller({ userId: "user_test_project_detail" });

    const result = await caller.detail({ id: PROJECT_ID });

    expect(result.versions.map((version) => version.id)).toEqual([
      "canceled-newest",
      "visible-older",
    ]);
    expect(
      result.versions.find((version) => version.id === "canceled-newest")?.audioUrl,
    ).toBeNull();
    expect(result.versions.find((version) => version.id === "visible-older")?.audioUrl).toBe(
      "https://audio.invalid/visible.wav",
    );
    expect(result.comments.map((comment) => comment.id)).toEqual([
      "hidden-comment",
      "visible-comment",
    ]);
    expect(whereCalls).toContainEqual({
      table: trackVersions,
      condition: {
        conditions: [
          { left: trackVersions.producerId, right: PRODUCER_ID },
          { left: trackVersions.trackId, right: [TRACK_ID] },
        ],
      },
    });
    expect(whereCalls).toContainEqual({
      table: trackComments,
      condition: {
        left: trackComments.versionId,
        right: ["canceled-newest", "visible-older"],
      },
    });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(transactionMock.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  });
});
