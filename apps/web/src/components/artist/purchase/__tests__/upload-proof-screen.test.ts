import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseProofAmountCents } from "../upload-proof-screen";

const here = dirname(fileURLToPath(import.meta.url));
const screenSource = readFileSync(join(here, "..", "upload-proof-screen.tsx"), "utf8");
const actionsSource = readFileSync(join(here, "..", "actions.ts"), "utf8");
const pageSource = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(artist)",
    "artist",
    "purchase",
    "[productId]",
    "pay",
    "proof",
    "page.tsx",
  ),
  "utf8",
);
const acceptedPurchasePaymentSource = readFileSync(
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
    "page.tsx",
  ),
  "utf8",
);

describe("private installment proof amount", () => {
  it("parses the artist's real represented amount exactly in cents", () => {
    expect(parseProofAmountCents("1200")).toBe(120_000);
    expect(parseProofAmountCents("1200.5")).toBe(120_050);
    expect(parseProofAmountCents("1200,05")).toBe(120_005);
    expect(parseProofAmountCents(" 1.01 ")).toBe(101);
  });

  it("rejects zero, negative, malformed, and over-precise amounts", () => {
    for (const value of ["", "0", "-1", "1.001", "1,2,3", "Infinity", "1000000000"]) {
      expect(parseProofAmountCents(value)).toBeNull();
    }
  });
});

describe("UploadProofScreen SK-75 wiring", () => {
  it("validates private JPG/PNG/WebP/HEIC/PDF uploads up to 15 MB", () => {
    expect(screenSource).toMatch(/type="file"/);
    expect(screenSource).toMatch(/image\/jpeg,image\/png,image\/webp,image\/heic/);
    expect(screenSource).toMatch(/application\/pdf/);
    expect(screenSource).toMatch(/15 \* 1024 \* 1024/);
    expect(screenSource).toMatch(/proofFileError\(picked\)/);
  });

  it("asks for the real amount and optional artist note", () => {
    expect(screenSource).toContain("Amount this receipt shows");
    expect(screenSource).toMatch(/parseProofAmountCents\(amount\)/);
    expect(screenSource).toMatch(/amountCents > thisProofCents/);
    expect(screenSource).toMatch(/id="proof-note"/);
    expect(screenSource).toMatch(/maxLength=\{2000\}/);
  });

  it("uses an opaque upload token and never sends storage identity through the client", () => {
    expect(screenSource).toMatch(/presigned\.uploadToken/);
    expect(screenSource).toMatch(/fetch\(presigned\.uploadUrl/);
    expect(screenSource).toMatch(/submitPaymentProofAction/);
    expect(actionsSource).toMatch(/proofOfPayment\.presign/);
    expect(actionsSource).toMatch(/proofOfPayment\.submit/);
    expect(screenSource).not.toMatch(/storageKey|objectEtag|storageBucket/);
    expect(actionsSource).not.toMatch(/storageKey|objectEtag|storageBucket/);
  });

  it("preserves rejected history, shows the producer note, and allows replacement", () => {
    expect(screenSource).toContain("Producer note");
    expect(screenSource).toContain("Choose replacement");
    expect(screenSource).toContain("Proof history");
    expect(screenSource).toMatch(/proof\.rejectionNote/);
    expect(screenSource).toMatch(/proof\.evidenceUrl/);
    expect(screenSource).toMatch(/Open private evidence/);
  });

  it("submits and refreshes Payments without adding proof work to Requests", () => {
    const submitAction = actionsSource.slice(
      actionsSource.indexOf("export async function submitPaymentProofAction"),
    );
    expect(submitAction).toMatch(/revalidatePath\("\/dashboard\/payments", "layout"\)/);
    expect(submitAction).toMatch(
      /revalidatePath\(`\/dashboard\/payments\/\$\{result\.proofId\}`\)/,
    );
    expect(submitAction).not.toMatch(/dashboard\/requests|purchaseRequestId/);
  });

  it("loads exact purchase/installment state and maps immutable proof history", () => {
    expect(pageSource).toMatch(/proofOfPayment\.state\(\{[\s\S]*purchaseId: purchase/);
    expect(pageSource).toMatch(/installmentId: installment/);
    expect(pageSource).toMatch(/evidenceUrl: proof\.evidenceUrl/);
    expect(pageSource).toMatch(/originalFileName: proof\.originalFileName/);
    expect(pageSource).toMatch(/rejectionNote: proof\.rejectionNote/);
    expect(pageSource).not.toMatch(/purchaseRequestId: req/);
  });

  it("keeps the accepted-purchase payment entry usable after submit or rejection", () => {
    expect(acceptedPurchasePaymentSource).toMatch(
      /proofOfPayment\.state\(\{ purchaseId \}\)/,
    );
    expect(acceptedPurchasePaymentSource).toMatch(
      /\/artist\/payments\/\$\{encodeURIComponent\(proofState\.purchaseId\)\}\/proof/,
    );
    expect(acceptedPurchasePaymentSource).toMatch(/installment: proofState\.installmentId/);
  });

  it("polls only while review is pending and remains usable at narrow widths", () => {
    expect(screenSource).toMatch(/status !== "awaiting" \|\| previewOnly/);
    expect(screenSource).toMatch(/setInterval\(\(\) => \{[\s\S]*router\.refresh\(\);[\s\S]*\}, 8_000\)/);
    expect(screenSource).toMatch(/max-w-\[440px\]/);
    expect(screenSource).toMatch(/overflow-x-hidden/);
    expect(screenSource).toMatch(/min-\[390px\]:px-5/);
  });
});
