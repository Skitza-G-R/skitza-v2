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
const actionSource = readFileSync(
  join(webRoot, "src/app/(producer)/dashboard/clients-projects/upload-actions.ts"),
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

  it("selects an owned active purchase with remaining capacity for the project UI", () => {
    const detail = projectRouterSource.slice(
      projectRouterSource.indexOf("detail: producerProcedure"),
      projectRouterSource.indexOf("create: producerProcedure"),
    );

    expect(detail).toMatch(/eq\(purchases\.producerId, ctx\.producerId\)/);
    expect(detail).toMatch(/eq\(purchases\.projectId, row\.id\)/);
    expect(detail).toMatch(/eq\(purchases\.lifecycleStatus, "active"\)/);
    expect(detail).toMatch(/includedSongSpaces/);
    expect(detail).toMatch(/songSpacePurchaseId: eligibleSongSpacePurchase\?\.id \?\? null/);
  });

  it("threads the exact eligible purchase through modal, action, and mutation", () => {
    expect(pageSource).toMatch(/songSpacePurchaseId=\{data\.songSpacePurchaseId\}/);
    expect(albumSource).toMatch(/purchaseId=\{songSpacePurchaseId\}/);
    expect(modalSource).toMatch(/addTrackAction\(\{[\s\S]*?projectId,[\s\S]*?purchaseId,/);
    expect(actionSource).toMatch(/addTrackAction\(input: \{[\s\S]*?purchaseId: string/);
    expect(actionSource).toMatch(/caller\.project\.addTrack\(input\)/);
  });

  it("fails closed in the new-song modal when no eligible purchase is available", () => {
    expect(modalSource).toMatch(/\(isNewSong && !purchaseId\)/);
    expect(modalSource).toMatch(/No active purchase has an available song space/);
  });
});
