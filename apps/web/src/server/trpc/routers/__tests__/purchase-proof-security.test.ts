import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { listPendingProducerProofs } from "../purchase";

const here = dirname(fileURLToPath(import.meta.url));
const purchaseSrc = readFileSync(join(here, "..", "purchase.ts"), "utf8");
const notificationEmitSrc = readFileSync(
  join(here, "..", "..", "..", "notifications", "emit.ts"),
  "utf8",
);
const shellDataSrc = readFileSync(join(here, "..", "..", "..", "shell-data.ts"), "utf8");
const artistProofStart = purchaseSrc.indexOf("// ── BE-2 — proof of payment (S9");
const artistProofEnd = purchaseSrc.indexOf("session: router({", artistProofStart);
const artistProofSrc = purchaseSrc.slice(artistProofStart, artistProofEnd);
const producerProofStart = purchaseSrc.indexOf("// ── BE-2 — Gate 2: verify / reject proofs");
const producerProofEnd = purchaseSrc.indexOf("session: router({", producerProofStart);
const producerProofSrc = purchaseSrc.slice(producerProofStart, producerProofEnd);

function procedureSource(start: string, end: string): string {
  const startIndex = producerProofSrc.indexOf(start);
  const foundEndIndex = producerProofSrc.indexOf(end, startIndex);
  const endIndex =
    foundEndIndex < 0 && end === "session: router({" ? producerProofSrc.length : foundEndIndex;
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not isolate ${start}`);
  }
  return producerProofSrc.slice(startIndex, endIndex);
}

describe("private proof API security contract", () => {
  it("keeps the producer queue fail-closed before 0023 and supports exact-request filtering", () => {
    const pending = procedureSource("pending: producerProcedure", "view: producerProcedure");
    const helperStart = purchaseSrc.indexOf("export async function listPendingProducerProofs");
    const helperEnd = purchaseSrc.indexOf("// Migration 0023", helperStart);
    const helper = purchaseSrc.slice(helperStart, helperEnd);

    expect(pending).toMatch(/purchaseRequestId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
    expect(pending).toMatch(
      /listPendingProducerProofs\(ctx\.db, ctx\.producerId, input\?\.purchaseRequestId\)/,
    );
    expect(helper).toMatch(/paymentProofsTableAvailable/);
    expect(helper).toMatch(/return \{ available: false as const, proofs: \[\] \}/);
    expect(helper).toMatch(/eq\(paymentProofs\.purchaseRequestId, purchaseRequestId\)/);
    expect(helper).toMatch(/eq\(purchaseRequests\.id, purchaseRequestId\)/);
    expect(helper).toMatch(/eq\(purchaseRequests\.producerId, producerId\)/);
    expect(helper).toMatch(/if \(!ownedRequest\) throw new TRPCError\(\{ code: "NOT_FOUND" \}\)/);
    expect(helper).toMatch(/return \{ available: true as const, proofs: rows \}/);
    expect(helper.indexOf("paymentProofsTableAvailable")).toBeLessThan(
      helper.indexOf(".from(paymentProofs)"),
    );
  });

  it("returns an unavailable empty queue without selecting the missing table", async () => {
    const select = vi.fn(() => {
      throw new Error("payment_proofs must not be selected before migration 0023");
    });
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [{ tableCount: 0 }] }),
      select,
    } as unknown as Parameters<typeof listPendingProducerProofs>[0];

    await expect(listPendingProducerProofs(db, "producer-1")).resolves.toEqual({
      available: false,
      proofs: [],
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("returns an available filtered queue after migration 0023", async () => {
    const rows = [
      {
        proofId: "11111111-1111-4111-8111-111111111111",
        purchaseRequestId: "22222222-2222-4222-8222-222222222222",
      },
    ];
    const where = vi.fn();
    const query = {
      innerJoin: vi.fn(() => query),
      where: vi.fn((predicate: unknown) => {
        where(predicate);
        return { orderBy: () => Promise.resolve(rows) };
      }),
    };
    const select = vi
      .fn()
      .mockImplementationOnce(() => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ id: rows[0]?.purchaseRequestId }]) }),
        }),
      }))
      .mockImplementationOnce(() => ({ from: () => query }));
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [{ tableCount: 1 }] }),
      select,
    } as unknown as Parameters<typeof listPendingProducerProofs>[0];

    await expect(
      listPendingProducerProofs(db, "producer-1", rows[0]?.purchaseRequestId),
    ).resolves.toEqual({ available: true, proofs: rows });
    expect(select).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledOnce();
  });

  it("turns a foreign request filter into NOT_FOUND before selecting proof rows", async () => {
    const select = vi.fn(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }));
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [{ tableCount: 1 }] }),
      select,
    } as unknown as Parameters<typeof listPendingProducerProofs>[0];

    await expect(
      listPendingProducerProofs(
        db,
        "producer-1",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(select).toHaveBeenCalledOnce();
  });

  it.each([
    ["view: producerProcedure", "confirm: producerProcedure"],
    ["confirm: producerProcedure", "reject: producerProcedure"],
    ["reject: producerProcedure", "session: router({"],
  ])("checks migration 0023 before touching proof data in %s", (start, end) => {
    const procedure = procedureSource(start, end);
    expect(procedure).toMatch(/await assertPaymentProofsTableAvailable\(ctx\.db\)/);
    expect(procedure.indexOf("assertPaymentProofsTableAvailable")).toBeLessThan(
      procedure.indexOf("loadProducerProof"),
    );
  });

  it("never exposes or accepts a separate artist-controlled storage key", () => {
    const presign = artistProofSrc.slice(
      artistProofSrc.indexOf("presign: artistProcedure"),
      artistProofSrc.indexOf("submit: artistProcedure"),
    );
    const submit = artistProofSrc.slice(artistProofSrc.indexOf("submit: artistProcedure"));

    expect(presign).toMatch(/return \{ uploadUrl \}/);
    expect(presign).not.toMatch(/return \{ uploadUrl, storageKey/);
    expect(submit).not.toMatch(/storageKey:\s*z\.string/);
    expect(submit).toMatch(/const stagingKey = buildProofStagingKey/);
    expect(submit).not.toMatch(/input\.storageKey/);
    expect(submit).not.toMatch(/publicUrl/);
  });

  it("never returns a signed evidence URL or final object key to the artist", () => {
    expect(artistProofSrc).not.toMatch(/view: artistProcedure/);
    expect(artistProofSrc).not.toMatch(/return \{ url, expiresInSeconds/);
    expect(artistProofSrc).not.toMatch(/Key: proof\.storageKey/);
  });

  it("requires an artist contact to belong to the request's producer", () => {
    const resolverStart = purchaseSrc.indexOf("async function resolveOwnedRequest");
    const resolverEnd = purchaseSrc.indexOf("async function loadProducerRequest", resolverStart);
    const resolver = purchaseSrc.slice(resolverStart, resolverEnd);

    expect(resolver).toMatch(/eq\(clientContacts\.producerId, request\.producerId\)/);
  });

  it("pins every proof object operation to docs and verifies the copied ETag", () => {
    expect(purchaseSrc).not.toMatch(/BUCKETS\[proof\.storageBucket\]/);
    expect(purchaseSrc).toMatch(/proof\.storageBucket !== "docs"/);
    expect(artistProofSrc).toMatch(/CopyObjectResult\?\.ETag/);
    expect(artistProofSrc).toMatch(/IfMatch:\s*copyEtag/);
    expect(artistProofSrc).toMatch(/finalEtag !== copyEtag/);
    expect(artistProofSrc).toMatch(/CopySourceIfMatch:\s*stagingEtag/);
  });

  it("keeps locked proof updates tenant-, request-, and state-scoped", () => {
    const confirm = procedureSource("confirm: producerProcedure", "reject: producerProcedure");
    const reject = procedureSource("reject: producerProcedure", "session: router({");

    for (const procedure of [confirm, reject]) {
      expect(procedure).toMatch(/eq\(paymentProofs\.producerId, ctx\.producerId\)/);
      expect(procedure).toMatch(/eq\(paymentProofs\.purchaseRequestId, lockedRequest\.id\)/);
      expect(procedure).toMatch(/eq\(paymentProofs\.status, "pending"\)/);
    }
  });

  it("clears only the owning producer's proof notification after either decision", () => {
    const helperStart = purchaseSrc.indexOf("async function markProofNotificationsReadQuietly");
    const helperEnd = purchaseSrc.indexOf("async function deleteProofObjectQuietly", helperStart);
    const helper = purchaseSrc.slice(helperStart, helperEnd);
    const confirm = procedureSource("confirm: producerProcedure", "reject: producerProcedure");
    const reject = procedureSource("reject: producerProcedure", "session: router({");

    expect(helper).toMatch(/eq\(notifications\.producerId, producerId\)/);
    expect(helper).toMatch(/eq\(notifications\.id, proofId\)/);
    expect(helper).toMatch(/eq\(notifications\.purchaseRequestId, purchaseRequestId\)/);
    expect(helper).toMatch(/eq\(notifications\.kind, "proof_submitted"\)/);
    expect(helper).toMatch(/isNull\(notifications\.readAt\)/);
    expect(confirm).toMatch(/markProofNotificationsReadQuietly/);
    expect(reject).toMatch(/markProofNotificationsReadQuietly/);
  });

  it("gives each proof notification a durable exact proof identity", () => {
    const emitStart = notificationEmitSrc.indexOf("export async function emitProofSubmitted");
    const emitProof = notificationEmitSrc.slice(emitStart);

    expect(emitProof).toMatch(/proofId: string/);
    expect(emitProof).toMatch(/id: input\.proofId/);
    expect(artistProofSrc).toMatch(/emitProofSubmitted[\s\S]*proofId: row\.id/);
    expect(shellDataSrc).toMatch(/inArray\(paymentProofs\.id, proofNotificationIds\)/);
    expect(shellDataSrc).not.toMatch(/proof\.createdAt\.getTime\(\)/);
  });
});
