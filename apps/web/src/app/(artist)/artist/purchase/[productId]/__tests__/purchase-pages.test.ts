import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = readFileSync(join(here, "..", "page.tsx"), "utf8");
const request = readFileSync(join(here, "..", "request", "page.tsx"), "utf8");
const agree = readFileSync(join(here, "..", "agree", "page.tsx"), "utf8");
const sent = readFileSync(join(here, "..", "sent", "page.tsx"), "utf8");
const pay = readFileSync(join(here, "..", "pay", "page.tsx"), "utf8");
const instructions = readFileSync(
  join(here, "..", "pay", "instructions", "page.tsx"),
  "utf8",
);
const srcRoot = join(here, "..", "..", "..", "..", "..", "..");
const actions = readFileSync(
  join(srcRoot, "components", "artist", "purchase", "actions.ts"),
  "utf8",
);

describe("unified product entry route", () => {
  it("loads the owned Store product into the professional standing detail", () => {
    expect(entry).toMatch(/caller\.artist\.store\.product\(\{ productId \}\)/);
    expect(entry).toMatch(/toPurchaseProduct\(row\)/);
    expect(entry).toMatch(/<ProfessionalProductDetail/);
    expect(entry).toMatch(/activeForStudio/);
  });

  it("moves quantity and target intent into the focused request route", () => {
    expect(request).toMatch(/artist\.store\.product/);
    expect(request).toMatch(/activeForStudio/);
    expect(request).toMatch(/snapshotProductPrice/);
    expect(request).toMatch(/row\.targetProjects\.map/);
    expect(request).toMatch(/<PurchaseRequestScreen/);
  });

  it("maps inaccessible or invalid product ids to not found", () => {
    expect(entry).toMatch(/e\.code === "BAD_REQUEST"/);
    expect(entry).toMatch(/e\.code === "NOT_FOUND"/);
    expect(entry).toMatch(/notFound\(\)/);
  });
});

describe("final exact-agreement route", () => {
  it("requires a request id and one valid paid-plan query", () => {
    expect(agree).toMatch(/if \(!query\.req\)\s*\{/);
    expect(agree).toMatch(/withArtistStudio\([\s\S]{0,120}query\.studio/);
    expect(agree).toMatch(/parsePaymentPlanSearch\(query\)/);
    expect(agree).toMatch(/if \(!paymentPlan\)/);
  });

  it("loads a server-authored preview and prevents product/request mismatch", () => {
    expect(agree).toMatch(/caller\.artist\.purchase\.acceptance\.preview\(\{/);
    expect(agree).toMatch(/purchaseRequestId: query\.req/);
    expect(agree).toMatch(/paymentPlan,/);
    expect(agree).toMatch(/if \(preview\.productId !== productId\) notFound\(\)/);
  });

  it("does not rebuild acceptance terms from the mutable Store row", () => {
    expect(agree).not.toMatch(/artist\.store\.product|toPurchaseProduct|buildAgreementTerms/);
  });
});

describe("request, plan, and acceptance actions", () => {
  it("sends quantity and target only as optional request intent", () => {
    const request = actions.slice(
      actions.indexOf("export async function requestToBookAction"),
      actions.indexOf("export async function acceptPurchaseAction"),
    );
    expect(request).toMatch(/songQty\?: number/);
    expect(request).toMatch(/projectId\?: string/);
    expect(request).toMatch(/caller\.artist\.purchase\.request\(\{/);
    expect(request).not.toMatch(/paymentPlan|agreementAccepted|unitPriceCents/);
  });

  it("accepts plan, digest, explicit consent, and operation identity together", () => {
    const acceptance = actions.slice(
      actions.indexOf("export async function acceptPurchaseAction"),
      actions.indexOf("export async function presignProofUploadAction"),
    );
    expect(acceptance).toMatch(/paymentPlan: PaymentPlanChoice/);
    expect(acceptance).toMatch(/expectedSnapshotDigest: string/);
    expect(acceptance).toMatch(/agreementAccepted: true/);
    expect(acceptance).toMatch(/operationKey: string/);
    expect(acceptance).toMatch(/artist\.purchase\.acceptance\.accept\(input\)/);
  });
});

describe("approved request flow", () => {
  it("reads enabled plan options without persisting a choice", () => {
    expect(pay).toMatch(/artist\.purchase\.paymentPlan\.options/);
    expect(pay).toMatch(/livePlanOptions\(data\.options\)/);
    expect(pay).not.toMatch(/paymentPlan\.choose|chosenAt/);
  });

  it("opens payment instructions by immutable purchase id after acceptance", () => {
    expect(instructions).toMatch(
      /searchParams: Promise<\{ req\?: string; purchase\?: string; studio\?: string \}>/,
    );
    expect(instructions).toMatch(/paymentInstructions/);
    expect(instructions).toMatch(
      /\/artist\/payments\/\$\{encodeURIComponent\(data\.purchaseId\)\}\/instructions/,
    );
  });
});

describe("request-sent route", () => {
  it("requires the owned request identity and checks product consistency", () => {
    expect(sent).toMatch(/if \(!req\) redirect/);
    expect(sent).toMatch(/caller\.artist\.purchase\.get\(\{ purchaseRequestId: req \}\)/);
    expect(sent).toMatch(/request\.productId !== productId/);
    expect(sent).not.toMatch(/toPurchaseProduct|request\.priceCents/);
  });
});
