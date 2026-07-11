import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const OVERVIEW = readFileSync(join(here, "..", "overview-screen.tsx"), "utf8");
const PUBLIC_LINK = readFileSync(join(here, "..", "public-link-strip.tsx"), "utf8");
const PAYMENT_ROW = readFileSync(
  join(here, "..", "needs-you-payment-row.tsx"),
  "utf8",
);

describe("Calm Control overview", () => {
  it("renders one Needs You queue with an explicit capped View all path", () => {
    expect(OVERVIEW).toContain('id="needs-you"');
    expect(OVERVIEW).toContain("capNeedsYouQueue(items, showAll)");
    expect(OVERVIEW).toContain('/dashboard?view=all#needs-you');
  });

  it("keeps the desktop urgent/uploads pair and compact studio pulse", () => {
    expect(OVERVIEW).toContain("<UrgentProjectsCard");
    expect(OVERVIEW).toContain("<LatestUploadsCard");
    expect(OVERVIEW).toContain("<StudioPulse");
    expect(OVERVIEW).toContain("Earned this month");
    expect(OVERVIEW).toContain("Outstanding");
    expect(OVERVIEW).toContain("Active projects");
  });

  it("renders the phone-first Today, two-cell pulse, and latest-upload stack", () => {
    expect(OVERVIEW).toContain("<MobileTodayCard");
    expect(OVERVIEW).toContain("<MobileLatestUpload");
    expect(OVERVIEW).toMatch(/grid-cols-2[\s\S]*lg:grid-cols-3/);
  });

  it("does not reintroduce the removed Activity card", () => {
    expect(OVERVIEW).not.toContain('id="activity-heading"');
    expect(OVERVIEW).not.toContain(">Activity<");
  });

  it("uses Skitza tokens instead of literal palette utilities or hex", () => {
    expect(OVERVIEW).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(OVERVIEW).not.toMatch(/(?:bg|text)-(?:orange|yellow|blue|red)-\d{2,3}/);
    expect(OVERVIEW).toContain("rgb(var(--brand-primary))");
  });

  it("uses amber only for Review while Open project stays outlined", () => {
    expect(OVERVIEW).toContain('const primary = item.actionLabel === "Review"');
    expect(OVERVIEW).toContain("bg-[rgb(var(--brand-primary))]");
    expect(OVERVIEW).toContain("border-[rgb(var(--border-strong))]");
  });
});

describe("public link CTA", () => {
  it("copies the canonical /join URL and uses the explicit amber CTA", () => {
    expect(PUBLIC_LINK).toContain("buildJoinUrl(slug)");
    expect(PUBLIC_LINK).toContain("Copy public link");
    expect(PUBLIC_LINK).toContain("bg-[rgb(var(--brand-primary))]");
    expect(PUBLIC_LINK).toContain("text-[rgb(var(--fg-on-brand))]");
  });

  it("is desktop-only in the compact greeting row", () => {
    expect(PUBLIC_LINK).toMatch(/hidden[\s\S]*lg:flex/);
  });
});

describe("payment signal preservation", () => {
  it("keeps the tenant-scoped acknowledgement action and restores the row on failure", () => {
    expect(PAYMENT_ROW).toContain("acknowledgePaymentAction");
    expect(PAYMENT_ROW).toContain("setHidden(false)");
    expect(PAYMENT_ROW).toMatch(/catch \{/);
    expect(PAYMENT_ROW).toContain('role="alert"');
  });
});
