import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  PROJECT_ID,
  producers,
  projects,
  projectTracks,
  purchases,
  trackVersions,
  trackComments,
  dbMock,
} = vi.hoisted(() => {
  const PRODUCER_ID = "00000000-0000-4000-8000-000000000901";
  const PROJECT_ID = "00000000-0000-4000-8000-000000000902";
  const TRACK_ID = "00000000-0000-4000-8000-000000000903";
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
    commercialSnapshot: { __column: "purchases.commercial_snapshot" },
  };
  const trackVersions = {
    __table: "track_versions",
    id: { __column: "track_versions.id" },
    trackId: { __column: "track_versions.track_id" },
    uploadedAt: { __column: "track_versions.uploaded_at" },
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
    [projectTracks, [{ id: TRACK_ID, projectId: PROJECT_ID, purchaseId: null }]],
    [purchases, []],
    [
      trackVersions,
      [
        {
          id: "canceled-newest",
          trackId: TRACK_ID,
          uploadedAt: new Date("2026-07-18T12:00:00.000Z"),
          audioDeletedAt: new Date("2026-07-18T12:01:00.000Z"),
        },
        {
          id: "visible-older",
          trackId: TRACK_ID,
          uploadedAt: new Date("2026-07-17T12:00:00.000Z"),
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

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producers) {
          return {
            where: () => ({ limit: () => Promise.resolve([{ id: PRODUCER_ID }]) }),
          };
        }
        const rows = rowsByTable.get(table) ?? [];
        return {
          where: (condition: unknown) => {
            const selectedRows =
              table === trackVersions &&
              JSON.stringify(condition) === JSON.stringify({ isNull: trackVersions.audioDeletedAt })
                ? rows.filter((row) => row.audioDeletedAt === null)
                : rows;
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

  return {
    PROJECT_ID,
    producers,
    projects,
    projectTracks,
    purchases,
    trackVersions,
    trackComments,
    dbMock,
  };
});

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers,
  projects,
  projectTracks,
  purchases,
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
});

describe("project.detail canceled upload placeholders", () => {
  it("excludes audioDeletedAt versions and their comments from the returned version list", async () => {
    const { projectRouter } = await import("../project");
    const caller = projectRouter.createCaller({ userId: "user_test_project_detail" });

    const result = await caller.detail({ id: PROJECT_ID });

    expect(result.versions.map((version) => version.id)).toEqual(["visible-older"]);
    expect(result.comments.map((comment) => comment.id)).toEqual(["visible-comment"]);
  });
});
