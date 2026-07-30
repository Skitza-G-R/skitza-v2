import { describe, expect, it, vi } from "vitest";

import { authorizePrivateProofEvidence } from "../service";

function queryReturning(rows: readonly unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.limit = vi.fn(() => Promise.resolve(rows));
  return query;
}

const evidence = {
  proofId: "proof-1",
  producerId: "producer-1",
  storageKey: "proof-evidence/private",
  objectEtag: "etag-1",
  contentType: "application/pdf",
  sizeBytes: 1_024,
  originalFileName: "receipt.pdf",
};

describe("historical private proof evidence", () => {
  it("allows an archived artist only after exact proof and studio grants resolve", async () => {
    const active = queryReturning([]);
    const historical = queryReturning([evidence]);
    const studio = queryReturning([{ resourceId: "producer-1" }]);
    const select = vi
      .fn()
      .mockReturnValueOnce(active)
      .mockReturnValueOnce(historical)
      .mockReturnValueOnce(studio);

    await expect(
      authorizePrivateProofEvidence(
        { select } as never,
        { role: "artist", clerkUserId: "user-1", proofId: "proof-1" },
      ),
    ).resolves.toEqual({
      proofId: "proof-1",
      storageKey: "proof-evidence/private",
      objectEtag: "etag-1",
      contentType: "application/pdf",
      sizeBytes: 1_024,
      originalFileName: "receipt.pdf",
    });
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the exact proof grant is absent", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(queryReturning([]))
      .mockReturnValueOnce(queryReturning([]));

    await expect(
      authorizePrivateProofEvidence(
        { select } as never,
        { role: "artist", clerkUserId: "user-1", proofId: "proof-1" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the enclosing historical studio grant is absent", async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce(queryReturning([]))
      .mockReturnValueOnce(queryReturning([evidence]))
      .mockReturnValueOnce(queryReturning([]));

    await expect(
      authorizePrivateProofEvidence(
        { select } as never,
        { role: "artist", clerkUserId: "user-1", proofId: "proof-1" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(select).toHaveBeenCalledTimes(3);
  });
});
