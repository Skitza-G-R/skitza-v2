import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const domainRoot = join(here, "..");
const webSrc = join(domainRoot, "..", "..", "..");
const repositorySource = readFileSync(join(domainRoot, "db.ts"), "utf8");
const projectRouterSource = readFileSync(join(webSrc, "server/trpc/routers/project.ts"), "utf8");
const artistRouterSource = readFileSync(join(webSrc, "server/trpc/routers/artist.ts"), "utf8");
const audioRouterSource = readFileSync(join(webSrc, "server/trpc/routers/audio.ts"), "utf8");
const initiationSource = readFileSync(
  join(webSrc, "server/audio/pending-multipart-initiation.ts"),
  "utf8",
);

describe("exact-version approval wiring", () => {
  it("keeps producer readiness and artist approval on separate authenticated procedures", () => {
    expect(projectRouterSource).toContain("markVersionReady: producerProcedure");
    expect(projectRouterSource).toContain("markProducerVersionReady");
    expect(projectRouterSource).toContain("reopenApprovedSong: producerProcedure");
    expect(projectRouterSource).not.toContain("approveExactReadyVersion");

    expect(artistRouterSource).toContain("approveVersion: artistProcedure");
    expect(artistRouterSource).toContain("approveExactReadyVersion");
    expect(artistRouterSource).toContain("artistClerkUserId: ctx.clerkUserId");
  });

  it("discovers the verified active artist without leaking foreign ownership", () => {
    expect(repositorySource).toContain("eq(clientContacts.clerkUserId, scope.artistClerkUserId)");
    expect(repositorySource).toContain("isNull(clientContacts.archivedAt)");
    expect(repositorySource).toContain("eq(purchases.clientContactId, projects.clientContactId)");
    expect(repositorySource).toContain("return work(unavailableTransaction())");
  });

  it("serializes project, purchase, versions, events, and the final installment", () => {
    const projectLock = repositorySource.indexOf("hashtextextended(${discovery.projectId}");
    const purchaseLock = repositorySource.indexOf("hashtextextended(${discovery.purchaseId}");
    expect(projectLock).toBeGreaterThan(0);
    expect(purchaseLock).toBeGreaterThan(projectLock);
    expect(repositorySource.match(/\.for\("update"\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(repositorySource).toContain("isNull(purchaseInstallments.triggeredAt)");
    expect(repositorySource).toContain('eq(purchaseInstallments.dueTrigger, "artist_approval")');
  });

  it("rechecks the current approval lock at every database upload boundary", () => {
    expect(projectRouterSource).toContain("currentTrackArtistApprovalAction(tx");
    expect(audioRouterSource).toContain("assertVersionUploadAllowed");
    expect(audioRouterSource.match(/await assertVersionUploadAllowed\(/g)?.length ?? 0).toBe(5);
    expect(initiationSource.match(/currentTrackArtistApprovalAction\(tx/g)?.length ?? 0).toBe(3);
  });
});
