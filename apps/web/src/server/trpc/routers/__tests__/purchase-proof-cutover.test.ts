import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createDbMock } = vi.hoisted(() => ({
  createDbMock: vi.fn(() => ({})),
}));

vi.mock("@skitza/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@skitza/db")>();
  return { ...actual, createDb: createDbMock };
});

import { artistPurchaseRouter } from "../purchase";

const PAUSED_MESSAGE =
  "Payment-proof uploads are briefly paused while we secure them. Please try again in a few minutes.";

type LegacyProofCaller = {
  presign: (input: {
    purchaseRequestId: string;
    fileName: string;
    contentType: "image/png";
    sizeBytes: number;
  }) => Promise<unknown>;
  submit: (input: {
    purchaseRequestId: string;
    amountCents: number;
    fileUrl: string;
    note?: string;
  }) => Promise<unknown>;
};

const purchaseRequestId = "11111111-1111-4111-8111-111111111111";

function proofCaller(userId: string | null): LegacyProofCaller {
  const caller = artistPurchaseRouter.createCaller({ userId });
  return caller.proofOfPayment as unknown as LegacyProofCaller;
}

describe("SK-71 legacy public-proof safety bridge", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    process.env.DATABASE_URL = "postgresql://unused:unused@localhost/unused";
  });

  beforeEach(() => {
    createDbMock.mockClear();
  });

  afterAll(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("blocks the legacy public presign contract before database or storage work", async () => {
    const proof = proofCaller("artist_cutover_test");

    await expect(
      Promise.resolve().then(() =>
        proof.presign({
          purchaseRequestId,
          fileName: "proof.png",
          contentType: "image/png",
          sizeBytes: 1_024,
        }),
      ),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: PAUSED_MESSAGE });

    expect(createDbMock).not.toHaveBeenCalled();
  });

  it("blocks the legacy public submit contract before database or storage work", async () => {
    const proof = proofCaller("artist_cutover_test");

    await expect(
      proof.submit({
        purchaseRequestId,
        amountCents: 10_000,
        fileUrl: "https://public.example/proof.png",
        note: "Bank transfer",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: PAUSED_MESSAGE });

    expect(createDbMock).not.toHaveBeenCalled();
  });

  it("preserves authentication without constructing a database client", async () => {
    const proof = proofCaller(null);

    await expect(
      Promise.resolve().then(() =>
        proof.presign({
          purchaseRequestId,
          fileName: "proof.png",
          contentType: "image/png",
          sizeBytes: 1_024,
        }),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      proof.submit({
        purchaseRequestId,
        amountCents: 10_000,
        fileUrl: "https://public.example/proof.png",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(createDbMock).not.toHaveBeenCalled();
  });

  it("contains no database or public-storage path inside the artist proof router", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../purchase.ts", import.meta.url)),
      "utf8",
    );
    const artistRouterStart = source.indexOf("export const artistPurchaseRouter");
    const proofStart = source.indexOf("  proofOfPayment: router({", artistRouterStart);
    const proofEnd = source.indexOf("  session: router({", proofStart);
    const proofSource = source.slice(proofStart, proofEnd);

    expect(artistRouterStart).toBeGreaterThanOrEqual(0);
    expect(proofStart).toBeGreaterThan(artistRouterStart);
    expect(proofEnd).toBeGreaterThan(proofStart);
    expect(proofSource).toMatch(/presign: proofBridgeProcedure/);
    expect(proofSource).toMatch(/submit: proofBridgeProcedure/);
    expect(proofSource).not.toMatch(
      /artistProcedure|ctx\.db|createDb|getSignedUrl|PutObjectCommand|buildProofKey|BUCKETS\.audio|publicUrl|\.insert\(|\.update\(/,
    );
  });
});
