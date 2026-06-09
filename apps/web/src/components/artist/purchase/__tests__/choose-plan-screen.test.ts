import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatShekels, planOptions } from "../pay-data";

// Source-grep on S7 (Choose a payment plan) for the wiring that matters —
// matching the repo's existing test style (see commit-screens.test.ts). The
// money math itself is already unit-tested in pay-data.test.ts; here we lock
// the imports, the per-option rendering, the selection gate, and the route.

describe("pay-data plan helpers (used by S7)", () => {
  it("builds one option per allowed plan, summing to the total", () => {
    const opts = planOptions(240000, ["full", "split", "milestones"]);
    expect(opts).toHaveLength(3);
    for (const opt of opts) {
      const sum = opt.schedule.reduce((n, row) => n + row.amountCents, 0);
      expect(sum).toBe(240000);
    }
  });

  it("formats a schedule amount as whole grouped shekels", () => {
    expect(formatShekels(120000)).toBe("₪1,200");
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const S7_PATH = join(here, "..", "choose-plan-screen.tsx");
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
  "page.tsx",
);
const s7Src = readFileSync(S7_PATH, "utf8");
const pageSrc = readFileSync(PAGE_PATH, "utf8");

describe("choose-plan-screen.tsx (S7) wiring", () => {
  it("is a client component", () => {
    expect(s7Src).toMatch(/^"use client";/);
  });

  it("imports formatShekels from pay-data", () => {
    expect(s7Src).toMatch(/from "\.\/pay-data"/);
    expect(s7Src).toMatch(/formatShekels/);
  });

  it("page builds plan options from pay-data (planOptions / MOCK_*)", () => {
    expect(pageSrc).toMatch(/from "~\/components\/artist\/purchase\/pay-data"/);
    expect(pageSrc).toMatch(/MOCK_PLAN_OPTIONS|planOptions/);
  });

  it("renders a card per option and its schedule rows + amounts", () => {
    expect(s7Src).toMatch(/options\.map/);
    expect(s7Src).toMatch(/\.schedule\.map/);
    expect(s7Src).toMatch(/formatShekels\(/);
  });

  it("shows the due-now amount per option", () => {
    expect(s7Src).toMatch(/dueNowCents/);
  });

  it("gates the primary action on a plan being selected", () => {
    expect(s7Src).toMatch(/useState/);
    expect(s7Src).toMatch(/disabled=\{!selected\}/);
  });

  it("gives the selected card an amber ring (brand-primary)", () => {
    expect(s7Src).toMatch(/brand-primary/);
    expect(s7Src).toMatch(/brand-primary\) \/ 0\.06/);
  });

  it("routes Continue to the instructions step with the chosen plan", () => {
    expect(s7Src).toMatch(
      /router\.push\(`\/artist\/purchase\/\$\{productId\}\/pay\/instructions\?plan=\$\{selected\}`\)/,
    );
  });

  it("renders the screen title in Syne", () => {
    expect(s7Src).toMatch(/How would you like to pay\?/);
    expect(s7Src).toMatch(/font-syne/);
  });

  it("uses funnel chrome (back arrow + pinned primary CTA)", () => {
    expect(s7Src).toMatch(/FunnelTopBar/);
    expect(s7Src).toMatch(/PrimaryCta/);
    expect(s7Src).toMatch(/sk-safe-bottom/);
  });

  it("back arrow returns to the product purchase screen", () => {
    expect(s7Src).toMatch(/router\.push\(`\/artist\/purchase\/\$\{productId\}`\)/);
  });
});
