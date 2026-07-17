import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "../project.ts"), "utf8");
const addTrack = source.slice(
  source.indexOf("addTrack: producerProcedure"),
  source.indexOf("setTrackStage: producerProcedure"),
);
const detail = source.slice(
  source.indexOf("detail: producerProcedure"),
  source.indexOf("create: producerProcedure"),
);

describe("project.addTrack purchase-owned capacity boundary", () => {
  it("requires an explicit purchase id at the router input boundary", () => {
    const input = source.slice(
      source.indexOf("const AddTrackInput"),
      source.indexOf("const AddVersionInput"),
    );

    expect(input).toMatch(/purchaseId: z\.string\(\)\.uuid\(\)/);
    expect(input).not.toMatch(/purchaseId:[^\n]*optional/);
  });

  it("delegates allocation to the focused song-space domain service", () => {
    expect(addTrack).toMatch(/createPurchaseOwnedSongSpace\(/);
    expect(addTrack).toMatch(
      /includedSongSpaces: purchase\.commercialSnapshot\.includedSongSpaces/,
    );
    expect(addTrack).toMatch(/countPurchaseOwnedSongSpaces/);
    expect(addTrack).toMatch(/nextProjectPositionForUpdate/);
  });

  it("locks the project then exact purchase before counting or positioning", () => {
    const projectLock = addTrack.indexOf("hashtextextended(${input.projectId}, 0)");
    const purchaseLock = addTrack.indexOf("hashtextextended(${input.purchaseId}, 0)");
    const purchaseRead = addTrack.indexOf("getActivePurchaseForUpdate");

    expect(projectLock).toBeGreaterThan(-1);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(purchaseRead).toBeGreaterThan(purchaseLock);
  });

  it("scopes the active purchase by producer and project ownership", () => {
    expect(addTrack).toMatch(/eq\(purchases\.id, scope\.purchaseId\)/);
    expect(addTrack).toMatch(/eq\(purchases\.projectId, scope\.projectId\)/);
    expect(addTrack).toMatch(/eq\(purchases\.producerId, scope\.producerId\)/);
    expect(addTrack).toMatch(/eq\(purchases\.lifecycleStatus, "active"\)/);
    expect(addTrack).toMatch(/eq\(projects\.lifecycleStatus, "active"\)/);
    expect(addTrack).toMatch(/projectLifecycleStatus: projects\.lifecycleStatus/);
    expect(addTrack).toMatch(/projectLifecycleStatus: "active" as const/);
    expect(addTrack).toMatch(/\.for\("update"\)/);
  });

  it("persists the exact locked purchase and deterministic position", () => {
    expect(addTrack).toMatch(/purchaseId: songSpace\.purchaseId/);
    expect(addTrack).toMatch(/position: songSpace\.position/);
    expect(addTrack).not.toMatch(/existing\.length|nextPos/);
  });

  it("does not advertise a song-space allocation for an inactive project", () => {
    expect(detail).toMatch(/row\.lifecycleStatus === "active"[\s\S]*?activePurchases/);
    expect(detail).toMatch(/:\s*\[\];/);
    expect(detail).toMatch(/songSpacePurchaseId: eligibleSongSpacePurchase\?\.id \?\? null/);
  });
});
