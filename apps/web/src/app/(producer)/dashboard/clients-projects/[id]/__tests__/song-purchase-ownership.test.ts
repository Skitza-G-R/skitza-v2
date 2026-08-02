import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = process.cwd();
const repoRoot = join(webRoot, "../..");
const pageSource = readFileSync(
  join(webRoot, "src/app/(producer)/dashboard/clients-projects/[id]/page.tsx"),
  "utf8",
);
const schemaSource = readFileSync(join(repoRoot, "packages/db/src/schema.ts"), "utf8");
const projectRouterSource = readFileSync(
  join(webRoot, "src/server/trpc/routers/project.ts"),
  "utf8",
);
const modalSource = readFileSync(
  join(webRoot, "src/components/dashboard/song/upload-track-modal.tsx"),
  "utf8",
);
const albumSource = readFileSync(
  join(webRoot, "src/components/dashboard/project/album-space.tsx"),
  "utf8",
);
const addSongSource = readFileSync(
  join(webRoot, "src/components/dashboard/song/add-song-dialog.tsx"),
  "utf8",
);
const firstVersionSource = readFileSync(
  join(webRoot, "src/server/trpc/routers/first-version-upload.ts"),
  "utf8",
);

describe("SK-90 project song ownership", () => {
  it("removes the direct checkout creator and project-level song pricing projection", () => {
    expect(existsSync(join(webRoot, "src/server/payments/checkout-initiator.ts"))).toBe(false);
    expect(pageSource).not.toMatch(/songQty|unitPriceCents|checkout-initiator/);
  });

  it("requires each project track to name its owning purchase", () => {
    const projectTracks = schemaSource.slice(
      schemaSource.indexOf("export const projectTracks"),
      schemaSource.indexOf("export type ProjectTrack"),
    );

    expect(projectTracks).toMatch(/purchaseId:\s*uuid\("purchase_id"\)[\s\S]*?\.notNull\(\)/);
    expect(projectTracks).toContain("project_tracks_purchase_project_fk");
  });

  it("projects every owned purchase while exposing only active remaining capacity", () => {
    const detail = projectRouterSource.slice(
      projectRouterSource.indexOf("detail: producerProcedure"),
      projectRouterSource.indexOf("create: producerProcedure"),
    );

    expect(detail).toMatch(/eq\(purchases\.producerId, ctx\.producerId\)/);
    expect(detail).toMatch(/eq\(purchases\.projectId, row\.id\)/);
    expect(detail).toMatch(/summarizeProjectSongSpaces\(/);
    expect(detail).toMatch(/lifecycleStatus: purchase\.lifecycleStatus/);
    expect(detail).toMatch(/includedSongSpaces/);
    expect(detail).toMatch(
      /songSpacePurchaseId: songSpaces\.emptySlots\[0\]\?\.purchaseId \?\? null/,
    );
  });

  it("keeps commercial ownership server-side instead of making purchase the Add Song start", () => {
    expect(pageSource).not.toContain("emptySlots={");
    expect(albumSource).toContain('mode="new-song"');
    expect(albumSource).not.toContain("purchaseId=");
    expect(addSongSource).toMatch(/purchaseId: slot\.purchaseId/);
    expect(addSongSource).toMatch(/claimSongSpaceAction\(\{/);
    expect(firstVersionSource).toMatch(/purchaseId:\s*activeDestination\.purchaseId/);
    expect(firstVersionSource).toMatch(
      /includedSongSpaces:\s*lockedPurchase\.commercialSnapshot\.includedSongSpaces/,
    );
    expect(firstVersionSource).toMatch(/allocatedSongSpaces:\s*allocatedRows\.length/);
  });

  it("creates Song + V1 only in the atomic completion transaction", () => {
    expect(modalSource).toContain("prepareFirstVersionUploadAction");
    expect(modalSource).not.toContain("addTrackAction");
    expect(firstVersionSource).toMatch(
      /tx\.insert\(projectTracks\)[\s\S]*?tx\.insert\(trackVersions\)[\s\S]*?completedAt/,
    );
  });

  it("keeps incomplete legacy allocations out of the Project Song list", () => {
    expect(pageSource).toMatch(
      /durableVersionTrackIds[\s\S]*audioUrl !== null \|\| version\.audioDeletedAt !== null/,
    );
    expect(pageSource).toContain(
      "const durableTracks = data.tracks.filter((track) => durableVersionTrackIds.has(track.id))",
    );
    expect(pageSource).toContain("const tracks: TrackRowData[] = durableTracks.map");
    expect(pageSource).toContain("songsCount: durableTracks.length");
  });
});
