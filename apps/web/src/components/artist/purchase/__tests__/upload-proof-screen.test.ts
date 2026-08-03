import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const screenSource = readFileSync(join(here, "..", "upload-proof-screen.tsx"), "utf8");
const lifecycleSource = readFileSync(join(here, "..", "proof-upload-lifecycle.ts"), "utf8");
const actionsSource = readFileSync(join(here, "..", "actions.ts"), "utf8");
const newProofPageSource = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(artist)",
    "artist",
    "payments",
    "[purchaseId]",
    "proof",
    "new",
    "page.tsx",
  ),
  "utf8",
);
const recordPageSource = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(artist)",
    "artist",
    "payments",
    "[purchaseId]",
    "proof",
    "[proofId]",
    "page.tsx",
  ),
  "utf8",
);

describe("professional payment-proof upload", () => {
  it("locks the represented amount to the server-owned installment", () => {
    expect(screenSource).toContain("Locked installment amount");
    expect(screenSource).toMatch(/amountCents: thisProofCents/);
    expect(screenSource).not.toMatch(/parseProofAmountCents|Amount this receipt shows/);
  });

  it("validates one private JPG, PNG, WebP, HEIC, or PDF up to 15 MB", () => {
    expect(screenSource).toMatch(/type="file"/);
    expect(screenSource).toMatch(/image\/jpeg,image\/png,image\/webp,image\/heic/);
    expect(screenSource).toMatch(/application\/pdf/);
    expect(screenSource).toMatch(/15 \* 1024 \* 1024/);
    expect(screenSource).toMatch(/proofFileError\(selected\)/);
    expect(screenSource).toContain("Selected proof preview");
  });

  it("uses an opaque upload token and never sends storage identity through the client", () => {
    expect(screenSource).toMatch(/startManagedPaymentProofUpload/);
    expect(lifecycleSource).toMatch(/presigned\.uploadToken/);
    expect(lifecycleSource).toMatch(/uploadFile\(\{[\s\S]*uploadUrl: presigned\.uploadUrl/);
    expect(screenSource).toMatch(/cancelPaymentProofUploadAction/);
    expect(screenSource).toMatch(/submitPaymentProofAction/);
    expect(actionsSource).toMatch(/proofOfPayment\.presign/);
    expect(actionsSource).toMatch(/proofOfPayment\.cancel/);
    expect(actionsSource).toMatch(/proofOfPayment\.submit/);
    expect(`${screenSource}\n${lifecycleSource}`).not.toMatch(
      /storageKey|objectEtag|storageBucket/,
    );
  });

  it("reuses one browser operation key for interrupted retries", () => {
    expect(screenSource).toMatch(/proofOperationKey/);
    expect(screenSource).toMatch(/sessionStorage\.getItem/);
    expect(screenSource).toMatch(/sessionStorage\.setItem/);
    expect(screenSource).toMatch(/operationKey/);
    expect(lifecycleSource).toMatch(/operationKey: input\.operationKey/);
  });

  it("ends the focused process at the exact standing proof record", () => {
    expect(screenSource).toMatch(
      /\/artist\/payments\/\$\{purchaseId\}\/proof\/\$\{proofId\}/,
    );
    expect(lifecycleSource).toMatch(/onSuccess\?\.\(submitted\.proofId\)/);
    expect(recordPageSource).toMatch(/proof\.proofId === proofId/);
    expect(recordPageSource).toMatch(/<ProofRecordScreen/);
  });

  it("keeps prior proof records secondary and collapsed", () => {
    expect(screenSource).toMatch(/<details/);
    expect(screenSource).toContain("Payment history");
    expect(screenSource).toMatch(/proofs\.length > 0/);
    expect(screenSource).not.toMatch(/<textarea/);
  });

  it("loads the exact owned installment and blocks unavailable or duplicate upload entry", () => {
    expect(newProofPageSource).toMatch(/proofOfPayment\.state/);
    expect(newProofPageSource).toMatch(/installmentId: installment/);
    expect(newProofPageSource).toMatch(/latest\?\.status === "pending"/);
    expect(newProofPageSource).toMatch(/latest\?\.status === "confirmed"/);
    expect(newProofPageSource).toMatch(/!data\.proofUploadsAvailable/);
  });

  it("allows the exact new-proof route without loading Bank or Bit instructions", () => {
    expect(newProofPageSource).not.toMatch(/paymentInstructions/);
    expect(newProofPageSource).not.toMatch(/bankTransfer|bitPhone|notice=no-instructions/);
  });
});
