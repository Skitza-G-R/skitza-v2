import { beforeEach, describe, expect, it, vi } from "vitest";

import { SongManagementDomainError } from "~/server/domain/song-management/service";

// Tests for project.setTrackStage — Clients & Projects v3 redesign,
// Phase 4 (Upload Track modal + manual stage edit). Mirrors the
// project-set-stage-bulk.test.ts harness: marker objects + spies for
// SET payload + WHERE tree so the ownership chain (track → project →
// producer) and the UPDATE target column are independently testable.
//
// Ownership chain:
//   1. SELECT projectTracks WHERE id = trackId  -> NOT_FOUND if missing
//   2. SELECT projects.producerId WHERE id = projectId
//      -> NOT_FOUND if producerId !== ctx.producerId (no metadata leak)
//   3. UPDATE projectTracks.workflowStage WHERE id = trackId
//   4. UPDATE projects.updatedAt WHERE id = projectId  (bookkeeping)

const PRODUCER_ID = "producer-uuid-stage-1";
const TRACK_ID = "00000000-0000-0000-0000-000000000abc";

const {
  producersMarker,
  projectTracksMarker,
  projectsMarker,
  trackSelectMock,
  projectSelectMock,
  trackUpdateSetSpy,
  trackUpdateWhereSpy,
  projectUpdateSetSpy,
  projectUpdateWhereSpy,
  updateMock,
  setSongWorkflowStageMock,
  dbMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const trackSelectMock = vi.fn<() => Promise<Row[]>>();
  const projectSelectMock = vi.fn<() => Promise<Row[]>>();
  const trackUpdateSetSpy = vi.fn<(payload: Row) => void>();
  const trackUpdateWhereSpy = vi.fn<(where: unknown) => void>();
  const projectUpdateSetSpy = vi.fn<(payload: Row) => void>();
  const projectUpdateWhereSpy = vi.fn<(where: unknown) => void>();
  const updateMock = vi.fn<() => Promise<void>>();
  const setSongWorkflowStageMock = vi.fn<
    (
      db: unknown,
      input: {
        producerId: string;
        trackId: string;
        workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
        changedAt: Date;
      },
    ) => Promise<{
      workflowStage: "brief" | "production" | "mixing" | "mastering" | "done";
    }>
  >();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
  };
  const projectTracksMarker = {
    __table: "project_tracks",
    id: { __column: "project_tracks.id" },
    projectId: { __column: "project_tracks.project_id" },
    workflowStage: { __column: "project_tracks.workflow_stage" },
  };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    updatedAt: { __column: "projects.updated_at" },
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        if (table === projectTracksMarker) {
          return {
            where: () => ({
              limit: () => trackSelectMock(),
            }),
          };
        }
        if (table === projectsMarker) {
          return {
            where: () => ({
              limit: () => projectSelectMock(),
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    update: (table: unknown) => ({
      set: (payload: Row) => {
        if (table === projectTracksMarker) {
          trackUpdateSetSpy(payload);
          return {
            where: (w: unknown) => {
              trackUpdateWhereSpy(w);
              return updateMock();
            },
          };
        }
        if (table === projectsMarker) {
          projectUpdateSetSpy(payload);
          return {
            where: (w: unknown) => {
              projectUpdateWhereSpy(w);
              return updateMock();
            },
          };
        }
        throw new Error(`unexpected update(${String(table)})`);
      },
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    projectTracksMarker,
    projectsMarker,
    trackSelectMock,
    projectSelectMock,
    trackUpdateSetSpy,
    trackUpdateWhereSpy,
    projectUpdateSetSpy,
    projectUpdateWhereSpy,
    updateMock,
    setSongWorkflowStageMock,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_stage_1" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  projects: projectsMarker,
  projectTracks: projectTracksMarker,
  // Stub every other table the router module imports at load time.
  bookings: { __table: "bookings" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  notifications: { __table: "notifications" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  isNull: (col: unknown) => ({ isNull: col }),
  or: (...conds: unknown[]) => ({ or: conds }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  sql: () => ({ sql: true }),
}));
vi.mock("~/server/domain/song-management/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/domain/song-management/db")>();
  return { ...actual, setSongWorkflowStage: setSongWorkflowStageMock };
});
vi.mock("~/server/contacts/record", () => ({ recordContact: vi.fn() }));
vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.test",
  sendProducerRepliedToCommentEmail: vi.fn(),
  sendTrackVersionUploadedEmail: vi.fn(),
}));

beforeEach(() => {
  trackSelectMock.mockReset();
  projectSelectMock.mockReset();
  trackUpdateSetSpy.mockReset();
  trackUpdateWhereSpy.mockReset();
  projectUpdateSetSpy.mockReset();
  projectUpdateWhereSpy.mockReset();
  updateMock.mockReset().mockResolvedValue(undefined);
  setSongWorkflowStageMock.mockReset();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_stage_1" });
};

describe("project.setTrackStage", () => {
  it("updates workflowStage + returns the new stage when the producer owns the project", async () => {
    setSongWorkflowStageMock.mockResolvedValueOnce({ workflowStage: "mixing" });

    const caller = await buildCaller();
    const res = await caller.project.setTrackStage({
      trackId: TRACK_ID,
      workflowStage: "mixing",
    });

    expect(res).toEqual({ ok: true, workflowStage: "mixing" });

    expect(setSongWorkflowStageMock).toHaveBeenCalledExactlyOnceWith(
      dbMock,
      expect.objectContaining({
        producerId: PRODUCER_ID,
        trackId: TRACK_ID,
        workflowStage: "mixing",
      }),
    );
    expect(setSongWorkflowStageMock.mock.calls[0]?.[1].changedAt).toBeInstanceOf(Date);
  });

  it("accepts all 5 workflow stages", async () => {
    const stages = ["brief", "production", "mixing", "mastering", "done"] as const;
    for (const stage of stages) {
      setSongWorkflowStageMock.mockResolvedValueOnce({ workflowStage: stage });
      const caller = await buildCaller();
      const res = await caller.project.setTrackStage({
        trackId: TRACK_ID,
        workflowStage: stage,
      });
      expect(res.workflowStage).toBe(stage);
    }
  });

  it("throws NOT_FOUND when the track id is missing", async () => {
    setSongWorkflowStageMock.mockRejectedValueOnce(
      new SongManagementDomainError("NOT_FOUND", "The song was not found"),
    );

    const caller = await buildCaller();
    await expect(
      caller.project.setTrackStage({
        trackId: TRACK_ID,
        workflowStage: "mixing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // No UPDATE fires on a bogus track id.
    expect(trackUpdateSetSpy).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the producer doesn't own the parent project", async () => {
    setSongWorkflowStageMock.mockRejectedValueOnce(
      new SongManagementDomainError("NOT_FOUND", "The song was not found"),
    );

    const caller = await buildCaller();
    await expect(
      caller.project.setTrackStage({
        trackId: TRACK_ID,
        workflowStage: "mixing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(trackUpdateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid workflow stage via zod", async () => {
    const caller = await buildCaller();
    await expect(
      caller.project.setTrackStage({
        trackId: TRACK_ID,
        // Cast through unknown to exercise the zod guard with a value
        // outside the enum (TS would otherwise reject this at compile).
        workflowStage: "release" as unknown as "mixing",
      }),
    ).rejects.toThrow();
    expect(trackUpdateSetSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid trackId via zod", async () => {
    const caller = await buildCaller();
    await expect(
      caller.project.setTrackStage({
        trackId: "not-a-uuid",
        workflowStage: "mixing",
      }),
    ).rejects.toThrow();
    expect(trackUpdateSetSpy).not.toHaveBeenCalled();
  });
});
