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
const PAY_PAGE_PATH = join(
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
  "page.tsx",
);
const payPageSrc = readFileSync(PAY_PAGE_PATH, "utf8");
const INSTRUCTIONS_PAGE_PATH = join(
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
  "instructions",
  "page.tsx",
);
const instructionsPageSrc = readFileSync(INSTRUCTIONS_PAGE_PATH, "utf8");
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
    expect(s9Src).not.toMatch(/capture="environment"/);
  });

  it("validates a picked file before it can enter the attached state", () => {
    const onFileChange = s9Src.slice(
      s9Src.indexOf("function onFileChange"),
      s9Src.indexOf("function proofContentType"),
    );

    expect(onFileChange).toMatch(/proofFileError\(picked\)/);
    expect(onFileChange.indexOf("proofFileError(picked)")).toBeLessThan(
      onFileChange.indexOf("setFile(picked)"),
    );
    expect(s9Src).toMatch(/15 MB/);
  });

  it("normalizes accepted extensions when a browser omits the MIME type", () => {
    expect(s9Src).toMatch(/type === "" \|\| type === "application\/octet-stream"/);
    expect(s9Src).toMatch(/extension === "jpg" \|\| extension === "jpeg"/);
    expect(s9Src).toMatch(/extension === "png"/);
    expect(s9Src).toMatch(/extension === "webp"/);
    expect(s9Src).toMatch(/extension === "heic"/);
    expect(s9Src).toMatch(/extension === "pdf"/);
  });

  it("returns focus to the persistent upload tile after choosing a replacement", () => {
    expect(s9Src).toMatch(/ref=\{uploadButtonRef\}/);
    expect(s9Src).toMatch(/uploadButtonRef\.current\?\.focus\(\)/);
  });

  it("previews attached images and releases every temporary object URL", () => {
    expect(s9Src).toMatch(/URL\.createObjectURL\(picked\)/);
    expect(s9Src).toMatch(/URL\.revokeObjectURL\(previewUrlRef\.current\)/);
    expect(s9Src).toMatch(/backgroundImage:/);
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

  it("clears the native picker before re-upload so the same file can be selected again", () => {
    const reUpload = s9Src.slice(
      s9Src.indexOf("function reUpload()"),
      s9Src.indexOf("const headline", s9Src.indexOf("function reUpload()")),
    );

    expect(reUpload).toMatch(/fileRef\.current\.value = ""/);
    expect(reUpload.indexOf('fileRef.current.value = ""')).toBeLessThan(
      reUpload.indexOf("fileRef.current?.click()"),
    );
    // Cancelling the native picker must leave the server-owned rejection
    // banner and producer note intact.
    expect(reUpload).not.toMatch(/setStatus\(/);
    expect(reUpload).not.toMatch(/setFile\(/);
  });

  it("renders awaiting review as a leave-safe state instead of a disabled uploader", () => {
    expect(s9Src).toMatch(/Proof sent for verification/);
    expect(s9Src).toMatch(/if \(isAwaiting\) router\.push\("\/artist"\)/);
    expect(s9Src).toMatch(/Back to Home/);
    expect(s9Src).toMatch(/!isPaidInFull && !isAwaiting/);
  });

  it("uploads to the private presigned URL and then records the proof", () => {
    expect(s9Src).toMatch(/presignProofUploadAction/);
    expect(s9Src).toMatch(/fetch\(presigned\.uploadUrl/);
    expect(s9Src).toMatch(/submitPaymentProofAction/);
    expect(actionsSrc).toMatch(/proofOfPayment\.presign/);
    expect(actionsSrc).toMatch(/proofOfPayment\.submit/);
    expect(s9Src).not.toMatch(/setTimeout\(\(\) => \{\s*setStatus\("awaiting"\)/);
  });

  it("keeps the deterministic staging key server-only across both client actions", () => {
    const presignAction = actionsSrc.slice(
      actionsSrc.indexOf("export async function presignProofUploadAction"),
      actionsSrc.indexOf("export async function submitPaymentProofAction"),
    );
    const submitAction = actionsSrc.slice(
      actionsSrc.indexOf("export async function submitPaymentProofAction"),
    );

    expect(presignAction).not.toMatch(/storageKey/);
    expect(submitAction).not.toMatch(/storageKey/);
    expect(s9Src).not.toMatch(/presigned\.storageKey|storageKey:/);
  });

  it("revalidates artist pay state and every producer proof surface after submit", () => {
    const submitAction = actionsSrc.slice(
      actionsSrc.indexOf("export async function submitPaymentProofAction"),
    );

    expect(submitAction).not.toMatch(/productId: string/);
    expect(submitAction).toMatch(/result\.productId/);
    expect(submitAction).toMatch(/result\.purchaseRequestId/);
    expect(submitAction).toMatch(/revalidatePath\("\/artist", "layout"\)/);
    expect(submitAction).toMatch(/revalidatePath\(`\/artist\/purchase\/\$\{result\.productId\}\/pay`\)/);
    expect(submitAction).toMatch(
      /revalidatePath\(`\/artist\/purchase\/\$\{result\.productId\}\/pay\/instructions`\)/,
    );
    expect(submitAction).toMatch(
      /revalidatePath\(`\/artist\/purchase\/\$\{result\.productId\}\/pay\/proof`\)/,
    );
    expect(submitAction).toMatch(/revalidatePath\("\/dashboard", "layout"\)/);
    expect(submitAction).toMatch(/revalidatePath\("\/dashboard\/requests", "layout"\)/);
    expect(submitAction).toMatch(
      /revalidatePath\(`\/dashboard\/requests\/\$\{result\.purchaseRequestId\}`\)/,
    );
  });

  it("adopts refreshed server state and polls only while a proof is awaiting review", () => {
    expect(s9Src).toMatch(/useEffect/);
    expect(s9Src).toMatch(/setStatus\(initialStatus\)/);
    expect(s9Src).toMatch(/if \(status !== "awaiting"\) return/);
    expect(s9Src).toMatch(/setInterval\(\(\) => \{\s*router\.refresh\(\)/);
    expect(s9Src).toMatch(/clearInterval/);
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

  it("opens the exact paid project when proof confirmation unlocks booking", () => {
    expect(pageSrc).toMatch(/data\.projectId/);
    expect(pageSrc).toMatch(
      /`\/artist\/book\?studio=\$\{data\.producerId\}&project=\$\{data\.projectId\}`/,
    );
    expect(pageSrc).toMatch(/bookingHref=\{bookingHref\}/);
    expect(s9Src).toMatch(/router\.push\(bookingHref \?\? "\/artist\/book"\)/);
  });

  it("returns safely to payment instructions when the private proof ledger is unavailable", () => {
    expect(pageSrc).toMatch(/!data\.proofUploadsAvailable/);
    expect(pageSrc).toMatch(/\/pay\/instructions\?req=\$\{req\}/);
  });

  it("cannot bounce between instructions and proof on a pre-0023 database", () => {
    const proofRedirects = instructionsPageSrc.slice(
      instructionsPageSrc.indexOf("if (!data.amountDueNowCents)"),
      instructionsPageSrc.indexOf("const paymentDetails"),
    );

    expect(proofRedirects).toMatch(
      /if \(data\.proofUploadsAvailable\)[\s\S]*redirect\(`\/artist\/purchase\/\$\{productId\}\/pay\/proof/,
    );
    expect(proofRedirects).toMatch(/redirect\("\/artist"\)/);
    expect(proofRedirects).toMatch(
      /data\.proofUploadsAvailable &&[\s\S]*data\.pendingProofCents[\s\S]*redirect\(`\/artist\/purchase\/\$\{productId\}\/pay\/proof/,
    );
  });

  it("checks proof availability before S7 redirects a verifying or paid request to S9", () => {
    expect(payPageSrc).toMatch(/proofOfPayment\.state/);
    expect(payPageSrc).toMatch(/proofState\.proofUploadsAvailable/);
    expect(payPageSrc).toMatch(/\/pay\/instructions\?req=\$\{req\}/);
  });

  it("rejects non-paying states before sending an unchosen plan back to S7", () => {
    expect(pageSrc.indexOf("data.requestStatus")).toBeLessThan(
      pageSrc.indexOf("!data.planChosenAt"),
    );
    expect(pageSrc).toMatch(/redirect\("\/artist"\)/);
  });
});
