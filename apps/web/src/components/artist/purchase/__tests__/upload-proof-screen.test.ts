import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatShekels, paidProgress, proofStatusCopy } from "../pay-data";

// Real unit checks on the pure helpers the screen leans on (running total +
// status copy), plus source-grep on the S9 screen for the wiring that matters
// — matching the repo's existing test style (see commit-screens.test.ts).

describe("pay-data helpers used by S9", () => {
  it("derives a clamped running-total progress from paid / total", () => {
    const half = paidProgress(120000, 240000);
    expect(half.pct).toBe(50);
    expect(half.isPaidInFull).toBe(false);
    expect(half.paidLabel).toBe("₪1,200");
    expect(half.totalLabel).toBe("₪2,400");

    const full = paidProgress(240000, 240000);
    expect(full.pct).toBe(100);
    expect(full.isPaidInFull).toBe(true);

    // never overshoots when overpaid
    expect(paidProgress(300000, 240000).pct).toBe(100);
  });

  it("gives each proof status a headline + tone", () => {
    expect(proofStatusCopy("empty").tone).toBe("neutral");
    expect(proofStatusCopy("uploading").tone).toBe("pending");
    expect(proofStatusCopy("awaiting", "Gili Studio").headline).toContain("Gili Studio");
    expect(proofStatusCopy("rejected").tone).toBe("danger");
    expect(proofStatusCopy("paid").tone).toBe("success");
  });

  it("formats the proof amount as whole grouped shekels", () => {
    expect(formatShekels(120000)).toBe("₪1,200");
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const S9_PATH = join(here, "..", "upload-proof-screen.tsx");
const s9Src = readFileSync(S9_PATH, "utf8");
const PAGE_PATH = join(
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
);
const pageSrc = readFileSync(PAGE_PATH, "utf8");
const ACTIONS_PATH = join(here, "..", "actions.ts");
const actionsSrc = readFileSync(ACTIONS_PATH, "utf8");

describe("upload-proof-screen.tsx (S9) wiring", () => {
  it("is a client component", () => {
    expect(s9Src).toMatch(/^"use client";/);
  });

  it("imports the running-total + status helpers from pay-data", () => {
    expect(s9Src).toMatch(/paidProgress/);
    expect(s9Src).toMatch(/proofStatusCopy/);
    expect(s9Src).toMatch(/formatShekels/);
    expect(s9Src).toMatch(/from "\.\/pay-data"/);
  });

  it("uses the funnel chrome (back arrow top-left, no tab bar)", () => {
    expect(s9Src).toMatch(/FunnelTopBar/);
    expect(s9Src).toMatch(/Upload proof/);
  });

  it("renders a real file input that accepts images + pdf", () => {
    expect(s9Src).toMatch(/type="file"/);
    // The picker mirrors the server allow-list, including HEIC + PDF.
    expect(s9Src).toMatch(/accept="[^"]*image\/jpeg[^"]*image\/heic[^"]*"/);
    expect(s9Src).toMatch(/accept="[^"]*application\/pdf[^"]*"/);
  });

  it("keeps the programmatic file input out of the tab and accessibility trees", () => {
    const fileInput = s9Src.slice(
      s9Src.indexOf("<input"),
      s9Src.indexOf("/>", s9Src.indexOf("<input")),
    );

    expect(fileInput).toMatch(/type="file"/);
    expect(fileInput).toMatch(/\bhidden\b/);
    expect(fileInput).not.toMatch(/className="sr-only"/);
  });

  it("gates Send on a file being attached (disabled until file state set)", () => {
    // the primary action's disabled prop reads the attached-file state
    expect(s9Src).toMatch(/disabled=\{[^}]*!file/);
    expect(s9Src).toMatch(/Send proof/);
  });

  it("drives the running total off paidProgress (thin bar + label)", () => {
    expect(s9Src).toMatch(/paidProgress\(/);
    expect(s9Src).toMatch(/Paid so far/);
    // the progress bar width is bound to the computed pct
    expect(s9Src).toMatch(/\.pct/);
    expect(s9Src).toMatch(/role="progressbar"[\s\S]*?aria-label="Payment progress"/);
  });

  it("shows previous proofs from props with a status chip each", () => {
    expect(s9Src).toMatch(/proofs/);
    expect(s9Src).toMatch(/proofStatusCopy\(/);
  });

  it("designs the rejected state with a re-upload affordance + producer note", () => {
    expect(s9Src).toMatch(/rejected/);
    expect(s9Src).toMatch(/[Rr]e-?upload/);
    const reuploadControl = s9Src.slice(
      s9Src.indexOf("onClick={reUpload}"),
      s9Src.indexOf("</button>", s9Src.indexOf("onClick={reUpload}")),
    );
    expect(reuploadControl).toMatch(/min-h-11/);
  });

  it("uploads to the private presigned URL and then records the proof", () => {
    expect(s9Src).toMatch(/presignProofUploadAction/);
    expect(s9Src).toMatch(/fetch\(presigned\.uploadUrl/);
    expect(s9Src).toMatch(/submitPaymentProofAction/);
    expect(actionsSrc).toMatch(/proofOfPayment\.presign/);
    expect(actionsSrc).toMatch(/proofOfPayment\.submit/);
    expect(s9Src).not.toMatch(/setTimeout\(\(\) => \{\s*setStatus\("awaiting"\)/);
  });

  it("shows upload failures and keeps the user able to retry", () => {
    expect(s9Src).toMatch(/uploadError/);
    expect(s9Src).toMatch(/role="alert"/);
  });

  it("page reads the owned private proof state instead of mock totals", () => {
    expect(pageSrc).toMatch(/caller\.artist\.purchase\.proofOfPayment\.state/);
    expect(pageSrc).toMatch(/purchaseRequestId: req/);
    expect(pageSrc).toMatch(/data\.productId && data\.productId !== productId/);
    expect(pageSrc).not.toMatch(/MOCK_/);
  });

  it("returns safely to payment instructions when the private proof ledger is unavailable", () => {
    expect(pageSrc).toMatch(/!data\.proofUploadsAvailable/);
    expect(pageSrc).toMatch(/\/pay\/instructions\?req=\$\{req\}/);
  });

  it("rejects non-paying states before sending an unchosen plan back to S7", () => {
    expect(pageSrc.indexOf("data.requestStatus")).toBeLessThan(
      pageSrc.indexOf("!data.planChosenAt"),
    );
    expect(pageSrc).toMatch(/redirect\("\/artist"\)/);
  });
});
