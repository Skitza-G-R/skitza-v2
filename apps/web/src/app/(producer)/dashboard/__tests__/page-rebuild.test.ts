import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  formatGreetingDate,
  formatGreetingSummary,
} from "../page-helpers";

// Today / Overview page.
//
// History:
//   - Story 06 introduced DashboardGreeting → InboxSection →
//     RecentUploadsShelf → PulseCard → ContextualActions.
//   - Phase 4 replaced that populated layout with a single
//     <OverviewScreen> server component (Hero → Approvals →
//     Today's Session → Money split → Activity feed).
//   - 2026-05-14 removed the day-1 takeover. <OverviewScreen> now
//     renders unconditionally and each section handles its own empty
//     state inline.
//
// What this test pins:
//   1. Pure helpers from page-helpers.ts (greeting formatters).
//   2. Source-grep on page.tsx — retired Story 06 components are NOT
//      imported, <OverviewScreen> replaces them, the day-1 takeover
//      is gone, and the auth + skipper paths stay intact.
//   3. Filesystem — the retired Story 06 files are still deleted; the
//      OverviewScreen file exists; the deleted empty-onboarding file
//      stays gone.

const here = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(here, "..", "page.tsx");
// __tests__ is under app/(app)/dashboard/. Hop ../..  → (app)/, ../../../  → app/,
// ../../../../  → src/. Then resolve into components/dashboard/{today,revenue,overview}.
const TODAY_DIR = join(here, "..", "..", "..", "..", "components", "dashboard", "today");
const REVENUE_DIR = join(here, "..", "..", "..", "..", "components", "dashboard", "revenue");
const OVERVIEW_DIR = join(here, "..", "..", "..", "..", "components", "dashboard", "overview");
const pageSource = readFileSync(PAGE_PATH, "utf8");

// ─── Pure helpers ──────────────────────────────────────────────────

describe("formatGreetingDate", () => {
  it("formats a known date as Weekday, Month Day", () => {
    // Friday 2026-04-25 — a stable known anchor.
    const fri = new Date(Date.UTC(2026, 3, 25, 12, 0, 0));
    const out = formatGreetingDate(fri);
    expect(out).toMatch(/Saturday|Friday/); // depending on TZ — both ok
    expect(out).toContain("April");
    expect(out).toContain("25");
  });

  it("includes the weekday name", () => {
    const day = new Date(Date.UTC(2026, 0, 5, 12, 0, 0)); // 2026-01-05
    const out = formatGreetingDate(day);
    // Monday Jan 5 2026 — depending on TZ we get Sunday/Monday.
    expect(out).toMatch(/Sunday|Monday/);
  });
});

describe("formatGreetingSummary", () => {
  it("returns 'All quiet today.' when zero items need attention", () => {
    expect(formatGreetingSummary(0)).toBe("All quiet today.");
  });

  it("uses singular 'thing needs you' when exactly one item is unresolved", () => {
    expect(formatGreetingSummary(1)).toBe("1 thing needs you.");
  });

  it("uses plural 'things need you' when more than one item is unresolved", () => {
    expect(formatGreetingSummary(5)).toBe("5 things need you.");
  });

  it("handles 2 (smallest plural)", () => {
    expect(formatGreetingSummary(2)).toBe("2 things need you.");
  });
});

// ─── Source-grep — Phase 4 populated layout ────────────────────────

describe("Today page — Phase 4 populated layout", () => {
  it("imports <OverviewScreen> from components/dashboard/overview", () => {
    expect(pageSource).toMatch(
      /from "~\/components\/dashboard\/overview\/overview-screen"/,
    );
  });

  it("renders <OverviewScreen> inside the !empty branch", () => {
    // The OverviewScreen tag must exist and pass the populated props
    // (displayName, pulseStats, pendingApprovals, todaySession,
    // activity, now). We assert at least the tag + the props that
    // identify the new layout's data wiring.
    expect(pageSource).toContain("<OverviewScreen");
    expect(pageSource).toContain("pendingApprovals=");
    expect(pageSource).toContain("todaySession=");
    expect(pageSource).toContain("pulseStats=");
  });

  it("passes slug + recentUploads to <OverviewScreen>", () => {
    // Overview Polish: the public-link strip needs the producer's slug;
    // the recent uploads shelf needs the recentUploads array. Pinning
    // these catches a future regression where someone refactors page.tsx
    // and forgets to thread the props through.
    //
    // 2026-05-06: `publicBaseUrl` was removed from <OverviewScreen> —
    // PublicLinkStrip now reads the canonical origin directly from
    // `~/lib/share/public-url` (so misconfigured env vars can't leak
    // a Vercel preview host into producer bio links).
    expect(pageSource).toContain("slug={me.slug}");
    expect(pageSource).toContain("recentUploads={today.recentUploads.map(");
  });

  it("does NOT thread publicBaseUrl into <OverviewScreen>", () => {
    // Defense against regressing PublicLinkStrip back to env-driven URL.
    // Match the JSX call site only — leading newline filters out the
    // <DashboardEmptyOnboarding> branch which legitimately passes
    // publicBaseUrl as a prop.
    expect(pageSource).not.toMatch(
      /<OverviewScreen[\s\S]*?publicBaseUrl=\{publicBaseUrl\}/,
    );
  });

  it("calls booking.list with status='pending_approval' for the approvals card", () => {
    expect(pageSource).toContain(
      'caller.booking.list({ status: "pending_approval" })',
    );
  });
});

// ─── Source-grep — retired Story 06 components ─────────────────────

describe("Today page — retired Story 06 components are NOT imported", () => {
  it.each([
    "today/contextual-actions",
    "today/dashboard-greeting",
    "today/inbox-section",
    "today/today-list",
    "today/pulse-card",
    "today/recent-uploads-shelf",
  ])("does not import from %s", (slug) => {
    expect(pageSource).not.toContain(`from "~/components/dashboard/${slug}"`);
  });

  it.each([
    "<ContextualActions",
    "<DashboardGreeting",
    "<InboxSection",
    "<PulseCard",
    "<RecentUploadsShelf",
  ])("does not render %s", (tag) => {
    expect(pageSource).not.toContain(tag);
  });
});

// ─── Source-grep — preserved infrastructure ────────────────────────

describe("Today page — preserved page chrome (auth-fix territory)", () => {
  it("keeps the gradient hero (relative isolate wrapper)", () => {
    expect(pageSource).toContain("relative isolate");
  });

  it("keeps max-w-[1920px] for ultrawide producers", () => {
    expect(pageSource).toContain("max-w-[1920px]");
  });

  it("keeps the sk-page-enter mount animation", () => {
    expect(pageSource).toContain("sk-page-enter");
  });

  it("keeps the FinishSetupNudge trigger (skipper + empty inbox)", () => {
    expect(pageSource).toContain("showSetupNudge");
    expect(pageSource).toContain("FinishSetupNudge");
  });
});

// ─── Source-grep — day-1 takeover is gone ──────────────────────────

describe("Today page — day-1 takeover removed", () => {
  it("does not import DashboardEmptyOnboarding (deleted 2026-05-14)", () => {
    expect(pageSource).not.toContain("DashboardEmptyOnboarding");
  });

  it("does not reference isDayOneEmpty (helper removed)", () => {
    expect(pageSource).not.toContain("isDayOneEmpty");
  });

  it("renders <OverviewScreen> unconditionally (no `empty ?` gate)", () => {
    // Source-grep: the OverviewScreen JSX must not sit inside a
    // ternary keyed on an `empty` flag. The new contract is "always
    // render". If someone re-introduces a takeover branch, this fails.
    expect(pageSource).not.toMatch(/!empty[\s\S]*?<OverviewScreen/);
    expect(pageSource).not.toMatch(/const empty =/);
  });
});

// ─── Filesystem — Story 06 + day-1 deletions held ─────────────────

describe("retired Story 06 files stay deleted from disk", () => {
  it.each([
    "share-link-card.tsx",
    "quick-actions.tsx",
    "kpi-strip.tsx",
    "empty-onboarding.tsx",
    "__tests__/quick-actions-pills.test.ts",
  ])("does not exist: today/%s", (rel) => {
    expect(existsSync(join(TODAY_DIR, rel))).toBe(false);
  });
});

describe("revenue-trend.tsx still in revenue/ directory", () => {
  it("no longer exists in dashboard/today/", () => {
    expect(existsSync(join(TODAY_DIR, "revenue-trend.tsx"))).toBe(false);
  });

  it("still exists in dashboard/revenue/", () => {
    expect(existsSync(join(REVENUE_DIR, "revenue-trend.tsx"))).toBe(true);
  });
});

// ─── Filesystem — Phase 4 new layout exists ────────────────────────

describe("Phase 4 OverviewScreen exists", () => {
  it("the new component file is present", () => {
    expect(existsSync(join(OVERVIEW_DIR, "overview-screen.tsx"))).toBe(true);
  });
});
