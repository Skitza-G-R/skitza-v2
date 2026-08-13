import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { parseClerkIdentityRelinkManifest } from "./manifest";
import {
  createClerkRelinkProviderReader,
  verifyClerkRelinkProviderEvidence,
  type ClerkRelinkProviderReader,
} from "./provider";

const hash = (email: string) =>
  `sha256:${createHash("sha256").update(email.toLowerCase()).digest("hex")}`;

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
      verifiedEmailHash: hash(`principal-${String(index)}@example.test`),
      expectedRoles: [role],
      expectedArtistLinkCount: count,
    })),
  });
}

function reader(instanceId: string, prefix: "old" | "new"): ClerkRelinkProviderReader {
  return {
    getInstanceId: vi.fn().mockResolvedValue(instanceId),
    getUser: vi.fn((userId: string) => {
      const emailIndex =
        prefix === "old"
          ? manifest().principals.findIndex((item) => item.canonicalClerkUserId === userId)
          : manifest().principals.findIndex((item) => item.targetProviderClerkUserId === userId);
      return Promise.resolve({
        id: userId,
        banned: false,
        locked: false,
        email_addresses: [
          {
            email_address: ` Principal-${String(emailIndex)}@Example.Test `,
            verification: { status: "verified" },
          },
        ],
      });
    }),
  };
}

describe("Clerk relink provider evidence", () => {
  it("proves both instances and the exact twelve manifest user IDs", async () => {
    const value = manifest();
    const source = reader(value.sourceClerkInstanceId, "old");
    const target = reader(value.targetClerkInstanceId, "new");
    await expect(
      verifyClerkRelinkProviderEvidence({ source, target }, value),
    ).resolves.toBeUndefined();
    expect(source.getUser).toHaveBeenCalledTimes(6);
    expect(target.getUser).toHaveBeenCalledTimes(6);
    expect(source.getUser).toHaveBeenCalledWith("old_p1");
    expect(target.getUser).toHaveBeenCalledWith("new_a4");
  });

  it("does not accept a hash found only on the source account", async () => {
    const value = manifest();
    const source = reader(value.sourceClerkInstanceId, "old");
    const target = reader(value.targetClerkInstanceId, "new");
    vi.mocked(target.getUser).mockImplementation((userId) =>
      Promise.resolve({
        id: userId,
        banned: false,
        locked: false,
        email_addresses: [],
      }),
    );
    await expect(verifyClerkRelinkProviderEvidence({ source, target }, value)).rejects.toThrow(
      "RELINK_PROVIDER_EVIDENCE_MISMATCH",
    );
  });

  it("uses exact user endpoints and never emits an email query", async () => {
    const fetcher = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith("/instance")
              ? { id: "ins_exact" }
              : { id: "user_exact", banned: false, locked: false, email_addresses: [] },
          ),
          { status: 200 },
        ),
      ),
    );
    const exact = createClerkRelinkProviderReader("sk_private", fetcher);
    await exact.getInstanceId();
    await exact.getUser("user_exact");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.clerk.com/v1/instance",
      "https://api.clerk.com/v1/users/user_exact",
    ]);
    expect(fetcher.mock.calls.join(" ")).not.toContain("email");
  });
});
