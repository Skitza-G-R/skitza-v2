import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { executeClerkIdentityRelink } from "./command";
import { clerkIdentityRelinkManifestDigest, parseClerkIdentityRelinkManifest } from "./manifest";
import type { ClerkRelinkProviderReaders } from "./provider";
import type { ClerkIdentityRelinkBindingRow, ClerkIdentityRelinkRepository } from "./repository";

const hash = (digit: number) => `sha256:${String(digit).repeat(64)}`;

function manifest() {
  return parseClerkIdentityRelinkManifest({
    version: 1,
    batchId: "018f47f0-98d1-4c25-9d32-7fca12de3401",
    sourceClerkInstanceId: "ins_development",
    targetClerkInstanceId: "ins_production",
    producerInvitationCutoff: "2026-08-14T10:00:00.000Z",
    evidenceRef: "case:SK-229/relink-1",
    principals: [
      ["old_p1", "new_p1", "producer", 0],
      ["old_p2", "new_p2", "producer", 0],
      ["old_a1", "new_a1", "artist", 1],
      ["old_a2", "new_a2", "artist", 1],
      ["old_a3", "new_a3", "artist", 2],
      ["old_a4", "new_a4", "artist", 1],
    ].map(([canonicalClerkUserId, targetProviderClerkUserId, role, count], index) => ({
      canonicalClerkUserId,
      targetProviderClerkUserId,
      verifiedEmailHash: hash(index + 1),
      expectedRoles: [role],
      expectedArtistLinkCount: count,
    })),
  });
}

function dependencies() {
  const value = manifest();
  let rows: Awaited<ReturnType<ClerkIdentityRelinkRepository["inspectBatch"]>> = [];
  const providerUser = (id: string, index: number) => ({
    id,
    banned: false,
    locked: false,
    email_addresses: [
      {
        email_address: `principal-${String(index)}@example.test`,
        verification: { status: "verified" },
      },
    ],
  });
  // Override hashes with the real provider proof used by this test.
  const raw = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const rawPrincipals = raw.principals as Array<Record<string, unknown>>;
  rawPrincipals.forEach((item, index) => {
    item.verifiedEmailHash = `sha256:${createHash("sha256")
      .update(`principal-${String(index)}@example.test`)
      .digest("hex")}`;
  });
  const verifiedManifest = parseClerkIdentityRelinkManifest(raw);
  const digest = clerkIdentityRelinkManifestDigest(verifiedManifest);
  const bindingRows = (relinkStatus: "staged" | "active" | "revoked") =>
    verifiedManifest.principals.flatMap((item) => [
      {
        id: `native-${item.canonicalClerkUserId}`,
        batchId: verifiedManifest.batchId,
        kind: "native" as const,
        status: "active" as const,
        clerkInstanceId: verifiedManifest.sourceClerkInstanceId,
        providerClerkUserId: item.canonicalClerkUserId,
        canonicalClerkUserId: item.canonicalClerkUserId,
        verifiedEmailHash: item.verifiedEmailHash,
        sourceClerkInstanceId: null,
        sourceProviderClerkUserId: null,
        manifestDigest: digest,
        evidenceRef: verifiedManifest.evidenceRef,
        activatedAt: new Date("2026-08-13T10:00:00.000Z"),
        revokedAt: null,
      },
      {
        id: `relink-${item.canonicalClerkUserId}`,
        batchId: verifiedManifest.batchId,
        kind: "relink" as const,
        status: relinkStatus,
        clerkInstanceId: verifiedManifest.targetClerkInstanceId,
        providerClerkUserId: item.targetProviderClerkUserId,
        canonicalClerkUserId: item.canonicalClerkUserId,
        verifiedEmailHash: item.verifiedEmailHash,
        sourceClerkInstanceId: verifiedManifest.sourceClerkInstanceId,
        sourceProviderClerkUserId: item.canonicalClerkUserId,
        manifestDigest: digest,
        evidenceRef: verifiedManifest.evidenceRef,
        activatedAt: relinkStatus === "active" ? new Date("2026-08-13T10:01:00.000Z") : null,
        revokedAt: relinkStatus === "revoked" ? new Date("2026-08-13T10:01:00.000Z") : null,
      },
    ]);
  const repository: ClerkIdentityRelinkRepository = {
    inventory: vi.fn(() =>
      Promise.resolve(
        verifiedManifest.principals.map((item) => ({
          canonicalClerkUserId: item.canonicalClerkUserId,
          hasProducerRole: item.expectedRoles[0] === "producer",
          artistLinkCount: item.expectedArtistLinkCount,
          terminalDeleted: false,
        })),
      ),
    ),
    targetIdentitiesOccupied: vi.fn(() => Promise.resolve([])),
    inspectBatch: vi.fn(() => Promise.resolve(rows)),
    inspectPlan: vi.fn(() => Promise.resolve(rows)),
    stage: vi.fn(() => {
      rows = bindingRows("staged");
      return Promise.resolve();
    }),
    activate: vi.fn(() => {
      rows = bindingRows("active");
      return Promise.resolve();
    }),
    rejectStage: vi.fn(() => {
      rows = bindingRows("revoked");
      return Promise.resolve();
    }),
  };
  const sourceGet = vi.fn((id: string) => {
    const index = verifiedManifest.principals.findIndex((item) => item.canonicalClerkUserId === id);
    return Promise.resolve(providerUser(id, index));
  });
  const targetGet = vi.fn((id: string) => {
    const index = verifiedManifest.principals.findIndex(
      (item) => item.targetProviderClerkUserId === id,
    );
    return Promise.resolve(providerUser(id, index));
  });
  const providers: ClerkRelinkProviderReaders = {
    source: {
      getInstanceId: vi.fn().mockResolvedValue(verifiedManifest.sourceClerkInstanceId),
      getUser: sourceGet,
    },
    target: {
      getInstanceId: vi.fn().mockResolvedValue(verifiedManifest.targetClerkInstanceId),
      getUser: targetGet,
    },
  };
  const result = {
    manifest: verifiedManifest,
    providers,
    repository,
    configuredProducerInvitationCutoff: verifiedManifest.producerInvitationCutoff,
  };
  return result as typeof result & { approval?: string };
}

describe("Clerk identity relink command", () => {
  it("rehearses exact provider and role evidence without writing", async () => {
    const input = dependencies();
    await expect(executeClerkIdentityRelink("rehearse", input)).resolves.toMatchObject({
      status: "rehearsed",
      principalCount: 6,
    });
    expect(input.repository.stage).not.toHaveBeenCalled();
    expect(input.repository.activate).not.toHaveBeenCalled();
  });

  it("keeps source identities active while target relinks stage and activate", async () => {
    const input = dependencies();
    const digest = clerkIdentityRelinkManifestDigest(input.manifest);
    input.approval = `stage:${input.manifest.batchId}:${digest}`;
    await expect(executeClerkIdentityRelink("stage", input)).resolves.toMatchObject({
      bindingCount: 12,
      status: "staged",
    });
    const stagedRows = await input.repository.inspectBatch(input.manifest.batchId);
    expect(
      stagedRows
        .filter((row: ClerkIdentityRelinkBindingRow) => row.kind === "native")
        .every((row: ClerkIdentityRelinkBindingRow) => row.status === "active"),
    ).toBe(true);
    expect(
      stagedRows
        .filter((row: ClerkIdentityRelinkBindingRow) => row.kind === "relink")
        .every((row: ClerkIdentityRelinkBindingRow) => row.status === "staged"),
    ).toBe(true);
    input.approval = `activate:${input.manifest.batchId}:${digest}`;
    await expect(executeClerkIdentityRelink("activate", input)).resolves.toMatchObject({
      bindingCount: 12,
      status: "active",
    });
    expect(input.repository.activate).toHaveBeenCalledOnce();
  });

  it("fails before writes for terminal old account state or cutoff drift", async () => {
    const input = dependencies();
    vi.mocked(input.repository.inventory).mockResolvedValueOnce(
      input.manifest.principals.map((item, index) => ({
        canonicalClerkUserId: item.canonicalClerkUserId,
        hasProducerRole: item.expectedRoles[0] === "producer",
        artistLinkCount: item.expectedArtistLinkCount,
        terminalDeleted: index === 0,
      })),
    );
    await expect(executeClerkIdentityRelink("rehearse", input)).rejects.toThrow(
      "RELINK_INVENTORY_MISMATCH",
    );
    expect(input.repository.stage).not.toHaveBeenCalled();

    const cutoff = dependencies();
    cutoff.configuredProducerInvitationCutoff = "2026-08-14T11:00:00.000Z";
    await expect(executeClerkIdentityRelink("rehearse", cutoff)).rejects.toThrow(
      "RELINK_MANIFEST_INVALID",
    );
  });

  it("rejects occupied target identities before staging", async () => {
    const input = dependencies();
    vi.mocked(input.repository.targetIdentitiesOccupied).mockResolvedValueOnce(["new_p1"]);
    await expect(executeClerkIdentityRelink("rehearse", input)).rejects.toThrow(
      "RELINK_INVENTORY_MISMATCH",
    );
    expect(input.repository.stage).not.toHaveBeenCalled();
  });

  it("can reject an exact staged batch when current provider proof is unavailable", async () => {
    const input = dependencies();
    const digest = clerkIdentityRelinkManifestDigest(input.manifest);
    input.approval = `stage:${input.manifest.batchId}:${digest}`;
    await executeClerkIdentityRelink("stage", input);
    vi.mocked(input.providers.target.getInstanceId).mockClear();
    vi.mocked(input.providers.target.getInstanceId).mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    input.approval = `reject-stage:${input.manifest.batchId}:${digest}`;
    await expect(executeClerkIdentityRelink("reject-stage", input)).resolves.toMatchObject({
      status: "rejected",
    });
    expect(input.providers.target.getInstanceId).not.toHaveBeenCalled();
  });
});
