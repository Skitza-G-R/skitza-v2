import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { livePlanOptions } from "../pay-data";

const here = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(join(here, "..", "choose-plan-screen.tsx"), "utf8");
const page = readFileSync(
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
    "page.tsx",
  ),
  "utf8",
);

describe("enabled payment-plan mapping", () => {
  it("preserves exact server schedule amounts", () => {
    const options = livePlanOptions([
      {
        kind: "monthly",
        installments: 3,
        charges: [80001, 80000, 80000],
        dueNowCents: 80001,
        labels: ["Due at acceptance", "Month 2", "Month 3"],
      },
    ]);
    expect(options[0]?.choice).toEqual({ kind: "monthly", installments: 3 });
    expect(options[0]?.schedule.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
      240001,
    );
  });
});

describe("choose-plan screen", () => {
  it("reads only server-enabled Full, 50/50, or Monthly options", () => {
    expect(page).toMatch(/caller\.artist\.purchase\.paymentPlan\.options/);
    expect(screen).toMatch(/type LivePlanOption/);
    expect(screen).toMatch(/option\.choice\.kind !== "monthly"/);
    expect(screen).toMatch(/option\.choice\.installments >= 2/);
    expect(screen).toMatch(/option\.choice\.installments <= 12/);
    expect(screen).not.toMatch(/milestone|card checkout/i);
  });

  it("renders each exact schedule in the request currency", () => {
    expect(screen).toMatch(/enabledOptions\.map/);
    expect(screen).toMatch(/opt\.schedule\.map/);
    expect(screen).toMatch(/formatPurchaseMoney\(row\.amountCents, currency\)/);
    expect(page).toMatch(/currency=\{data\.currency\}/);
  });

  it("requires an explicit selection unless only one plan is enabled", () => {
    expect(screen).toMatch(/enabledOptions\.length === 1/);
    expect(screen).toMatch(/disabled=\{!selected\}/);
  });

  it("uses an accessible keyboard radio pattern with one tab stop", () => {
    expect(screen).toMatch(/role="radiogroup"/);
    expect(screen).toMatch(/role="radio"/);
    expect(screen).toMatch(/nextPlanIndex/);
    expect(screen).toMatch(/tabIndex=\{tabStopIndex === i \? 0 : -1\}/);
    expect(screen).toMatch(/event\.key === " " \|\| event\.key === "Enter"/);
  });

  it("carries the choice to exact review without persisting it", () => {
    expect(screen).toMatch(/paymentPlanAgreementHref/);
    expect(screen).toMatch(/Continue to agreement/);
    expect(screen).not.toMatch(/choosePaymentPlanAction|paymentPlan\.choose/);
  });

  it("describes the exact installment boundary without generic deposit promises", () => {
    expect(screen).toMatch(/first installment follows/);
    expect(screen).toMatch(/complete installment is confirmed/);
    expect(screen).not.toMatch(/deposit secures|sessions can run on a deposit/i);
  });

  it("keeps pending/declined requests out of the payment funnel", () => {
    expect(page).toMatch(/if \(data\.status !== "approved"\)/);
    expect(page).toContain('redirect(withArtistStudio("/artist", data.producerId))');
  });
});
