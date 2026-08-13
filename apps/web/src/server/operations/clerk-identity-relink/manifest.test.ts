import { describe, expect, it } from "vitest";

import {
  clerkIdentityRelinkManifestDigest,
  parseClerkIdentityRelinkManifest,
  requireClerkIdentityRelinkApproval,
} from "./manifest";

function manifest() {
  return {
    version: 1,
    batchId: "018f47f0-98d1-4c25-9d32-7fca12de3401",
    sourceClerkInstanceId: "ins_development",
    targetClerkInstanceId: "ins_production",
    producerInvitationCutoff: "2026-08-14T10:00:00.000Z",
    evidenceRef: "case:SK-229/relink-1",
    principals: [
      ["old_producer_1", "new_producer_1", "producer", 0],
      ["old_producer_2", "new_producer_2", "producer", 0],
      ["old_artist_1", "new_artist_1", "artist", 1],
      ["old_artist_2", "new_artist_2", "artist", 1],
      ["old_artist_3", "new_artist_3", "artist", 2],
      ["old_artist_4", "new_artist_4", "artist", 1],
    ].map(([canonicalClerkUserId, targetProviderClerkUserId, role, count], index) => ({
      canonicalClerkUserId,
      targetProviderClerkUserId,
      verifiedEmailHash: `sha256:${String(index + 1).repeat(64)}`,
      expectedRoles: [role],
      expectedArtistLinkCount: count,
    })),
  };
}

describe("six-account Clerk relink manifest", () => {
  it("accepts only the confirmed two-Producer/four-Artist inventory", () => {
    const parsed = parseClerkIdentityRelinkManifest(manifest());
    expect(parsed.principals).toHaveLength(6);
    expect(parsed.principals.filter((item) => item.expectedRoles[0] === "producer")).toHaveLength(
      2,
    );
    expect(
      parsed.principals
        .filter((item) => item.expectedRoles[0] === "artist")
        .map((item) => item.expectedArtistLinkCount)
        .sort(),
    ).toEqual([1, 1, 1, 2]);
  });

  it("rejects a duplicate identity, dual-role assumption, or embedded email", () => {
    const duplicate = manifest();
    const duplicatePrincipal = duplicate.principals[1];
    if (!duplicatePrincipal) throw new Error("missing test principal");
    duplicatePrincipal.canonicalClerkUserId = "old_producer_1";
    expect(() => parseClerkIdentityRelinkManifest(duplicate)).toThrow("RELINK_MANIFEST_INVALID");

    const crossSetCollision = manifest();
    const collidingPrincipal = crossSetCollision.principals[0];
    if (!collidingPrincipal) throw new Error("missing test principal");
    collidingPrincipal.targetProviderClerkUserId = "old_artist_1";
    expect(() => parseClerkIdentityRelinkManifest(crossSetCollision)).toThrow(
      "RELINK_MANIFEST_INVALID",
    );

    const dual = manifest();
    const dualPrincipal = dual.principals[0];
    if (!dualPrincipal) throw new Error("missing test principal");
    dualPrincipal.expectedRoles = ["producer", "artist"];
    expect(() => parseClerkIdentityRelinkManifest(dual)).toThrow("RELINK_MANIFEST_INVALID");

    expect(() =>
      parseClerkIdentityRelinkManifest({
        ...manifest(),
        principals: manifest().principals.map((item, index) =>
          index === 0 ? { ...item, email: "forbidden@example.test" } : item,
        ),
      }),
    ).toThrow("RELINK_MANIFEST_INVALID");
  });

  it("has a stable order-independent digest and exact mutation approval", () => {
    const first = parseClerkIdentityRelinkManifest(manifest());
    const reversed = parseClerkIdentityRelinkManifest({
      ...manifest(),
      principals: [...manifest().principals].reverse(),
    });
    expect(clerkIdentityRelinkManifestDigest(first)).toBe(
      clerkIdentityRelinkManifestDigest(reversed),
    );
    const approval = `stage:${first.batchId}:${clerkIdentityRelinkManifestDigest(first)}`;
    expect(() => {
      requireClerkIdentityRelinkApproval("stage", first, approval);
    }).not.toThrow();
    expect(() => {
      requireClerkIdentityRelinkApproval("activate", first, approval);
    }).toThrow("RELINK_APPROVAL_INVALID");
  });
});
