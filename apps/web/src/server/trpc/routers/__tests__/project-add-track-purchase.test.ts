import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  FOREIGN_TRACK_ID,
  producers,
  projects,
  projectTracks,
  purchases,
  executeSpy,
  transactionSpy,
  dbMock,
} = vi.hoisted(() => {
  const PRODUCER_ID = "00000000-0000-4000-8000-000000000921";
  const FOREIGN_PROJECT_ID = "00000000-0000-4000-8000-000000000922";
  const FOREIGN_PURCHASE_ID = "00000000-0000-4000-8000-000000000923";
  const FOREIGN_TRACK_ID = "00000000-0000-4000-8000-000000000924";
  const FOREIGN_PRODUCER_ID = "00000000-0000-4000-8000-000000000925";
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
  };
  const purchases = {
    __table: "purchases",
    id: { __column: "purchases.id" },
    producerId: { __column: "purchases.producer_id" },
    projectId: { __column: "purchases.project_id" },
    lifecycleStatus: { __column: "purchases.lifecycle_status" },
  };
  const foreignTrack = {
    id: FOREIGN_TRACK_ID,
    projectId: FOREIGN_PROJECT_ID,
    purchaseId: FOREIGN_PURCHASE_ID,
  };
  const lockable = (rows: Record<string, unknown>[]) => {
    const promise = Promise.resolve(rows);
    return {
      for: () => promise,
      then: promise.then.bind(promise),
    };
  };
  const executeSpy = vi.fn(() => Promise.resolve([]));
  const tx = {
    execute: executeSpy,
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () =>
            lockable(
              table === projects
                ? [
                    {
                      id: FOREIGN_PROJECT_ID,
                      producerId: FOREIGN_PRODUCER_ID,
                      lifecycleStatus: "active",
                    },
                  ]
                : table === purchases
                  ? [
                      {
                        id: FOREIGN_PURCHASE_ID,
                        producerId: FOREIGN_PRODUCER_ID,
                        projectId: FOREIGN_PROJECT_ID,
                        lifecycleStatus: "active",
                      },
                    ]
                  : [foreignTrack],
            ),
        }),
      }),
    }),
  };
  const transactionSpy = vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) =>
    work(tx),
  );
  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producers) {
          return {
            where: () => ({ limit: () => Promise.resolve([{ id: PRODUCER_ID }]) }),
          };
        }

        let joinCount = 0;
        const query = {
          innerJoin: () => {
            joinCount += 1;
            return query;
          },
          where: () => ({
            // The known UUID is visible to an unscoped track-only lookup,
            // but a producer/project/purchase join must filter it out.
            limit: () => Promise.resolve(joinCount >= 2 ? [] : [foreignTrack]),
          }),
        };
        return query;
      },
    }),
    transaction: transactionSpy,
  };

  return {
    FOREIGN_TRACK_ID,
    producers,
    projects,
    projectTracks,
    purchases,
    executeSpy,
    transactionSpy,
    dbMock,
  };
});

vi.mock("@skitza/db", () => ({
  bookings: { __table: "bookings" },
  createDb: () => dbMock,
  producers,
  projects,
  projectTracks,
  purchaseInstallments: { __table: "purchase_installments" },
  purchases,
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  and: (...conditions: unknown[]) => ({ conditions }),
  asc: (value: unknown) => value,
  desc: (value: unknown) => value,
  eq: (left: unknown, right: unknown) => ({ left, right }),
  inArray: (left: unknown, right: unknown) => ({ left, right }),
  isNull: (value: unknown) => ({ isNull: value }),
  sql: Object.assign(() => ({ sql: true }), { raw: () => ({ sql: true }) }),
}));

vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.test",
  sendProducerRepliedToCommentEmail: vi.fn(),
}));

const source = readFileSync(join(__dirname, "../project.ts"), "utf8");
const repositorySource = readFileSync(join(__dirname, "../../../domain/song-spaces/db.ts"), "utf8");
const noChargeDomainSource = readFileSync(
  join(__dirname, "../../../domain/song-spaces/no-charge.ts"),
  "utf8",
);
const noChargeRepositorySource = readFileSync(
  join(__dirname, "../../../domain/song-spaces/no-charge-db.ts"),
  "utf8",
);
const addTrack = source.slice(
  source.indexOf("addTrack: producerProcedure"),
  source.indexOf("setTrackStage: producerProcedure"),
);
const noChargeProposal = source.slice(
  source.indexOf("noChargeProposal: router({"),
  source.indexOf("setTrackStage: producerProcedure"),
);
const createNoChargeProposal = noChargeProposal.slice(
  noChargeProposal.indexOf("create: producerProcedure"),
  noChargeProposal.indexOf("preview: artistProcedure"),
);
const previewNoChargeProposal = noChargeProposal.slice(
  noChargeProposal.indexOf("preview: artistProcedure"),
  noChargeProposal.indexOf("accept: artistProcedure"),
);
const acceptNoChargeProposal = noChargeProposal.slice(
  noChargeProposal.indexOf("accept: artistProcedure"),
);
const detail = source.slice(
  source.indexOf("detail: producerProcedure"),
  source.indexOf("create: producerProcedure"),
);
const addVersion = source.slice(
  source.indexOf("addVersion: producerProcedure"),
  source.indexOf("deleteVersion: producerProcedure"),
);

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/sk92";
  executeSpy.mockClear();
  transactionSpy.mockClear();
});

describe("project.addTrack purchase-owned capacity boundary", () => {
  it("requires an explicit purchase id at the router input boundary", () => {
    const input = source.slice(
      source.indexOf("const AddTrackInput"),
      source.indexOf("const AddVersionInput"),
    );

    expect(input).toMatch(/purchaseId: z\.string\(\)\.uuid\(\)/);
    expect(input).toMatch(/operationKey: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/);
    expect(input).not.toMatch(/purchaseId:[^\n]*optional/);
  });

  it("delegates allocation to the focused song-space domain service", () => {
    expect(addTrack).toMatch(/createPurchaseOwnedSongSpace\(/);
    expect(addTrack).toMatch(/songSpaceRepository\(ctx\.db\)/);
    expect(repositorySource).toMatch(
      /includedSongSpaces: purchase\.commercialSnapshot\.includedSongSpaces/,
    );
    expect(repositorySource).toMatch(/countPurchaseOwnedSongSpaces/);
    expect(repositorySource).toMatch(/nextProjectPositionForUpdate/);
    expect(repositorySource).toMatch(/findSongSpaceByIdForUpdate/);
  });

  it("locks the project then exact purchase before counting or positioning", () => {
    const projectLock = repositorySource.indexOf("projectAdvisoryLockKey(scope.projectId)");
    const purchaseLock = repositorySource.indexOf("purchaseAdvisoryLockKey(scope.purchaseId)");
    const purchaseRead = repositorySource.indexOf("getActivePurchaseForUpdate");

    expect(projectLock).toBeGreaterThan(-1);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(purchaseRead).toBeGreaterThan(purchaseLock);
  });

  it("scopes the active purchase by producer and project ownership", () => {
    expect(repositorySource).toMatch(/eq\(purchases\.id, lockedScope\.purchaseId\)/);
    expect(repositorySource).toMatch(/eq\(purchases\.projectId, lockedScope\.projectId\)/);
    expect(repositorySource).toMatch(/eq\(purchases\.producerId, lockedScope\.producerId\)/);
    expect(repositorySource).toMatch(/eq\(purchases\.lifecycleStatus, "active"\)/);
    expect(repositorySource).toMatch(/eq\(projects\.lifecycleStatus, "active"\)/);
    expect(repositorySource).toMatch(/projectLifecycleStatus: projects\.lifecycleStatus/);
    expect(repositorySource).toMatch(/projectLifecycleStatus: "active" as const/);
    expect(repositorySource).toMatch(/\.for\("update"\)/);
  });

  it("persists the exact locked purchase and deterministic position", () => {
    expect(repositorySource).toMatch(/purchaseId: songSpace\.purchaseId/);
    expect(repositorySource).toMatch(/position: songSpace\.position/);
    expect(repositorySource).not.toMatch(/existing\.length|nextPos/);
  });

  it("returns the complete virtual-slot projection instead of one advisory capacity count", () => {
    expect(detail).toMatch(/summarizeProjectSongSpaces\(/);
    expect(detail).toMatch(/songSpaces,/);
    expect(detail).toMatch(
      /songSpacePurchaseId: songSpaces\.emptySlots\[0\]\?\.purchaseId \?\? null/,
    );
  });

  it("lets the producer create only a signed No charge proposal", () => {
    const input = source.slice(
      source.indexOf("const CreateNoChargeProposalInput"),
      source.indexOf("const AddVersionInput"),
    );

    expect(input).toMatch(/operationKey: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/);
    expect(input).toMatch(/songTitle: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(120\)/);
    expect(input).toMatch(/proposalToken: z\.string\(\)\.min\(1\)\.max\(4096\)/);
    expect(createNoChargeProposal).toContain("createNoChargeSongSpaceProposal");
    expect(createNoChargeProposal).toContain("noChargeProposalRepository(ctx.db)");
    expect(createNoChargeProposal).toContain("producerId: ctx.producerId");
    expect(createNoChargeProposal).not.toContain("clerkUserId:");
    expect(createNoChargeProposal).not.toContain("acceptPurchase");
    expect(createNoChargeProposal).not.toContain("insertSongSpace");
  });

  it("keeps preview and acceptance behind the artist identity boundary", () => {
    expect(previewNoChargeProposal).toContain("preview: artistProcedure");
    expect(previewNoChargeProposal).toContain("previewNoChargeSongSpaceProposal");
    expect(previewNoChargeProposal).toContain("clerkUserId: ctx.clerkUserId");
    expect(acceptNoChargeProposal).toContain("accept: artistProcedure");
    expect(acceptNoChargeProposal).toContain("acceptNoChargeSongSpaceProposal");
    expect(acceptNoChargeProposal).toContain("clerkUserId: ctx.clerkUserId");
  });

  it("accepts the signed proposal as a separate product-backed ₪0 purchase and one track", () => {
    expect(noChargeDomainSource).toContain("acceptPurchase(transaction.purchaseRepository");
    expect(noChargeDomainSource).toContain('kind: "no_charge_add_on"');
    expect(noChargeDomainSource).toContain("productId: payload.sourceProductId");
    expect(noChargeDomainSource).toContain("purchaseRequestId: null");
    expect(noChargeDomainSource).toContain("totalCents: 0");
    expect(noChargeDomainSource).toContain("plan: null");
    expect(noChargeDomainSource).toContain("transaction.insertSongSpace");
    expect(noChargeRepositorySource).toContain("purchaseRepositoryForTransaction(tx)");
    expect(noChargeRepositorySource).toContain('eq(purchases.lifecycleStatus, "active")');
    expect(noChargeRepositorySource).toMatch(/purchaseId: songSpace\.purchaseId/);
  });
});

describe("project.addVersion producer-owned discovery boundary", () => {
  it("verifies the exact producer/project/purchase binding before advisory locks", () => {
    const transactionStart = addVersion.indexOf("ctx.db.transaction");
    const discovery = addVersion.slice(0, transactionStart);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(discovery).toContain(".innerJoin(");
    expect(discovery).toContain("eq(projects.id, projectTracks.projectId)");
    expect(discovery).toContain("eq(projects.producerId, ctx.producerId)");
    expect(discovery).toContain("eq(purchases.id, projectTracks.purchaseId)");
    expect(discovery).toContain("eq(purchases.projectId, projectTracks.projectId)");
    expect(discovery).toContain("eq(purchases.producerId, ctx.producerId)");
  });

  it("does not acquire advisory locks for a known foreign track UUID", async () => {
    const { projectRouter } = await import("../project");
    const caller = projectRouter.createCaller({ userId: "user_test_sk92" });

    await expect(
      caller.addVersion({
        trackId: FOREIGN_TRACK_ID,
        label: "Mix 2",
        audioUrl: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(transactionSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
