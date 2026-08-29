import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const OVERVIEW = readFileSync(join(here, "..", "overview-screen.tsx"), "utf8");
const PUBLIC_LINK = readFileSync(join(here, "..", "public-link-strip.tsx"), "utf8");

describe("Calm Control overview", () => {
  it("keeps the runtime safe-view server payload stable between renders", () => {
    expect(OVERVIEW).toContain('import { useMemo } from "react"');
    expect(OVERVIEW).toMatch(
      /const overviewServerData = useMemo\([\s\S]*serverDisplayName[\s\S]*serverPulseStats\.activeProjects/,
    );
    expect(OVERVIEW).toContain("serverData: overviewServerData");
    expect(OVERVIEW).not.toMatch(/serverData:\s*\{\s*displayName:/);
  });

  it("renders one Needs You queue with an explicit capped View all path", () => {
    expect(OVERVIEW).toContain('id="needs-you"');
    expect(OVERVIEW).toContain("capNeedsYouQueue(items, showAll)");
    expect(OVERVIEW).toContain('/dashboard?view=all#needs-you');
  });

  it("keeps the desktop urgent/uploads pair and hides unavailable money", () => {
    expect(OVERVIEW).toContain("<UrgentProjectsCard");
    expect(OVERVIEW).toContain("<LatestUploadsCard");
    expect(OVERVIEW).toContain("<StudioPulse");
    expect(OVERVIEW).toContain("Earned this month");
    expect(OVERVIEW).toContain("Outstanding");
    expect(OVERVIEW).toContain("Active projects");
    expect(OVERVIEW).toMatch(/pulseStats\.commercialAvailable/);
    expect(OVERVIEW).toMatch(/thisMonthCents !== null/);
    expect(OVERVIEW).toMatch(/outstandingCents !== null/);
  });

  it("renders the phone-first Today, two-cell pulse, and latest-upload stack", () => {
    expect(OVERVIEW).toContain("<MobileTodayCard");
    expect(OVERVIEW).toContain("<MobileLatestUpload");
    expect(OVERVIEW).toMatch(/grid-cols-2[\s\S]*lg:grid-cols-3/);
  });

  it("uses upload iconography without implying that navigation starts playback", () => {
    expect(OVERVIEW).toContain("AudioLines");
    expect(OVERVIEW).not.toContain("<Play");
  });

  it("does not prefetch every protected latest-upload Song Page in the background", () => {
    expect(
      OVERVIEW.match(
        /href=\{`\/dashboard\/music\/\$\{upload\.versionId\}`\}\s+prefetch=\{false\}/g,
      ),
    ).toHaveLength(2);
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
    expect(PUBLIC_LINK).toContain("await copyPublicLink");
    expect(PUBLIC_LINK).toContain("Try copy again");
  });

  it("is desktop-only in the compact greeting row", () => {
    expect(PUBLIC_LINK).toMatch(/hidden[\s\S]*lg:flex/);
  });
});

describe("needs you rows", () => {
  it("names the action and the row it belongs to for assistive tech", () => {
    expect(OVERVIEW).toContain("${item.actionLabel}: ${item.title}");
  });

  it("renders every queue row through one component", () => {
    // The payment_received branch is gone, so there is no second row shape.
    expect(OVERVIEW).not.toContain("payment_received");
    expect(OVERVIEW).not.toContain("NeedsYouPaymentRow");
  });
});
