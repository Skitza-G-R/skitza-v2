import { describe, expect, it } from "vitest";

import { publicActiveWorkImportAssessment } from "../workflow";

describe("active work import public assessment", () => {
  it("never exposes capability verification secrets, proof tokens, maps, or stored row internals", () => {
    const internal = {
      state: "ready",
      row: {
        id: "row-1",
        draftRevision: 3,
        draftPayload: { internal: "draft-value" },
        operationKey: "internal-row-operation",
      },
      normalized: {
        clientName: "Artist",
        payments: [
          {
            operationKey: "payment-1",
            installmentPosition: 1,
            amountCents: 1_000,
            paidAt: new Date("2026-08-20T10:00:00.000Z"),
            note: null,
            proofUploadToken: "signed-private-proof-token",
          },
        ],
      },
      creationDigest: `sha256:${"a".repeat(64)}`,
      proofCapabilities: new Map([
        ["payment-1", { secret: "server-verification-secret", capability: { uploadId: "x" } }],
      ]),
    } as unknown as Parameters<typeof publicActiveWorkImportAssessment>[0];

    const publicValue = publicActiveWorkImportAssessment(internal);
    const serialized = JSON.stringify(publicValue);

    expect(publicValue).toMatchObject({
      state: "ready",
      rowId: "row-1",
      draftRevision: 3,
      creationDigest: `sha256:${"a".repeat(64)}`,
      normalized: {
        clientName: "Artist",
        payments: [expect.objectContaining({ operationKey: "payment-1", hasProof: true })],
      },
    });
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("proofCapabilities");
    expect(serialized).not.toContain("signed-private-proof-token");
    expect(serialized).not.toContain("draft-value");
    expect(serialized).not.toContain("internal-row-operation");
  });
});
