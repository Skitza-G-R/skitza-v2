import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const componentRoot = join(here, "..", "..", "..");
const srcRoot = join(componentRoot, "..");
const listSource = readFileSync(join(here, "..", "payment-proof-list.tsx"), "utf8");
const reviewSource = readFileSync(join(here, "..", "payment-proof-review.tsx"), "utf8");
const actionsSource = readFileSync(
  join(srcRoot, "app", "(producer)", "dashboard", "payments", "proof-actions.ts"),
  "utf8",
);
const requestsPageSource = readFileSync(
  join(srcRoot, "app", "(producer)", "dashboard", "requests", "page.tsx"),
  "utf8",
);
const devFlowSource = readFileSync(
  join(componentRoot, "dev", "sk75-proof-flow-dev-screen.tsx"),
  "utf8",
);

describe("producer payment proof surfaces", () => {
  it("deep-links every queue and history row to the exact Payments item", () => {
    expect(listSource).toMatch(/\/dashboard\/payments\/\$\{encodeURIComponent\(proof\.proofId\)\}/);
    expect(reviewSource).toMatch(
      /\/dashboard\/payments\/\$\{encodeURIComponent\(item\.proofId\)\}/,
    );
    expect(listSource).not.toMatch(/dashboard\/requests/);
    expect(reviewSource).not.toMatch(/dashboard\/requests/);
  });

  it("shows exact fractional cents instead of rounding the artist-stated amount", () => {
    for (const source of [listSource, reviewSource]) {
      expect(source).toMatch(/withCents: cents % 100 !== 0/);
    }
    expect(reviewSource).toMatch(/Artist-stated amount/);
    expect(reviewSource).toMatch(/formatProofMoney\(proof\.amountCents, proof\.currency\)/);
  });

  it("shows all required review facts and the immutable decision contract", () => {
    for (const text of [
      "proof.artistName",
      "proof.projectTitle",
      "proof.productNameSnapshot",
      "proof.refNumber",
      "proof.installmentPosition",
      "proof.originalFileName",
      "proof.createdAt",
      "proof.proofNote",
      "Immutable proof history",
      "Record one immutable payment?",
    ]) {
      expect(reviewSource).toContain(text);
    }
  });

  it("keeps decisions in Payments and proof work entirely out of Requests", () => {
    expect(actionsSource).toMatch(/producer\.purchase\.proofOfPayment\.confirm/);
    expect(actionsSource).toMatch(/producer\.purchase\.proofOfPayment\.reject/);
    expect(actionsSource).toMatch(/revalidatePath\("\/dashboard\/payments", "layout"\)/);
    expect(actionsSource).not.toMatch(/dashboard\/requests/);
    expect(requestsPageSource).not.toMatch(/proofOfPayment|PaymentProof|ProofQueue/);
  });

  it("uses a mutation-free dev fixture for the required browser decision flow", () => {
    expect(devFlowSource).toContain('"producer-replacement"');
    expect(devFlowSource).toMatch(/onPreviewSubmit/);
    expect(devFlowSource).toMatch(/onPreviewDecision/);
    expect(devFlowSource).toMatch(/status: "rejected"/);
    expect(devFlowSource).toMatch(/status: stage === "confirmed" \? "confirmed" : "pending"/);
    expect(devFlowSource).not.toMatch(/appRouter|createDb|DATABASE_URL|getR2/);
  });
});
