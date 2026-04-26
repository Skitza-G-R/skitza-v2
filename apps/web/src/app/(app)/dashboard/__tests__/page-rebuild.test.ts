import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  isDayOneEmpty,
  formatGreetingDate,
  formatGreetingSummary,
} from "../page-helpers";

// Story 06 — Today page rebuild.
//
// Repo convention (CLAUDE.md → testing): vitest runs in `node` env, no
// jsdom. We pin three things:
//   1. Pure helpers (`isDayOneEmpty`, `formatGreetingDate`,
//      `formatGreetingSummary`) — the load-bearing logic of the rebuild.
//   2. Source-grep on page.tsx — the render order of the new sections,
//      that retired components are NOT imported, that the gradient hero
//      / max-w-[1920px] container / sk-page-enter mount animation are
//      preserved (the spec says only the content within is restructured),
//      that FinishSetupNudge's existing trigger predicate stays intact.
//   3. Filesystem assertions — the retired files no longer exist.

const here = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(here, "..", "page.tsx");
// __tests__ is under app/(app)/dashboard/. Hop ../..  → (app)/, ../../../  → app/,
// ../../../../  → src/. Then resolve into components/dashboard/{today,revenue}.
const TODAY_DIR = join(here, "..", "..", "..", "..", "components", "dashboard", "today");
const REVENUE_DIR = join(here, "..", "..", "..", "..", "components", "dashboard", "revenue");
const pageSource = readFileSync(PAGE_PATH, "utf8");

// ─── Pure helpers ──────────────────────────────────────────────────

describe("isDayOneEmpty", () => {
  it("returns true when uploads, projects, and items are all empty", () => {
    expect(
      isDayOneEmpty({
        recentUploadsCount: 0,
        activeProjectsCount: 0,
        itemsCount: 0,
      }),
    ).toBe(true);
  });

  it("returns false when there are recent uploads", () => {
    expect(
      isDayOneEmpty({
        recentUploadsCount: 1,
        activeProjectsCount: 0,
        itemsCount: 0,
      }),
    ).toBe(false);
  });

  it("returns false when there are active projects", () => {
    expect(
      isDayOneEmpty({
        recentUploadsCount: 0,
        activeProjectsCount: 1,
        itemsCount: 0,
      }),
    ).toBe(false);
  });

  it("returns false when there are inbox items", () => {
    expect(
      isDayOneEmpty({
        recentUploadsCount: 0,
        activeProjectsCount: 0,
        itemsCount: 1,
      }),
    ).toBe(false);
  });

  it("returns false when ALL three are positive", () => {
    expect(
      isDayOneEmpty({
        recentUploadsCount: 5,
        activeProjectsCount: 3,
        itemsCount: 2,
      }),
    ).toBe(false);
  });
});

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

// ─── Source-grep — page.tsx render order ────────────────────────────

describe("Today page — render order (new components in workflow order)", () => {
  // The spec locks the order: greeting → inbox → recent uploads →
  // pulse + contextual actions. Source-position match guards against
  // a future refactor reshuffling the layout.
  it("renders <DashboardGreeting> before <InboxSection>", () => {
    const greeting = pageSource.indexOf("<DashboardGreeting");
    const inbox = pageSource.indexOf("<InboxSection");
    expect(greeting).toBeGreaterThan(-1);
    expect(inbox).toBeGreaterThan(-1);
    expect(greeting).toBeLessThan(inbox);
  });

  it("renders <InboxSection> before <RecentUploadsShelf>", () => {
    const inbox = pageSource.indexOf("<InboxSection");
    const shelf = pageSource.indexOf("<RecentUploadsShelf");
    expect(inbox).toBeGreaterThan(-1);
    expect(shelf).toBeGreaterThan(-1);
    expect(inbox).toBeLessThan(shelf);
  });

  it("renders <RecentUploadsShelf> before <PulseCard>", () => {
    const shelf = pageSource.indexOf("<RecentUploadsShelf");
    const pulse = pageSource.indexOf("<PulseCard");
    expect(shelf).toBeGreaterThan(-1);
    expect(pulse).toBeGreaterThan(-1);
    expect(shelf).toBeLessThan(pulse);
  });

  it("renders <PulseCard> before <ContextualActions>", () => {
    const pulse = pageSource.indexOf("<PulseCard");
    const actions = pageSource.indexOf("<ContextualActions");
    expect(pulse).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(-1);
    expect(pulse).toBeLessThan(actions);
  });
});

// ─── Source-grep — retired imports must be gone ────────────────────

describe("Today page — retired components are not imported", () => {
  it.each([
    "share-link-card",
    "quick-actions",
    "kpi-strip",
    "today/revenue-trend",
    "today-view",
  ])("does not import from %s", (slug) => {
    expect(pageSource).not.toContain(`from "~/components/dashboard/today/${slug}"`);
  });
});

// ─── Source-grep — preserved infrastructure ────────────────────────

describe("Today page — preserved page chrome", () => {
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
    // Predicate exists in the file: skipOnboarding && !hasPackages && items === 0.
    expect(pageSource).toContain("showSetupNudge");
    expect(pageSource).toContain("FinishSetupNudge");
  });
});

// ─── Source-grep — empty-state branch ──────────────────────────────

describe("Today page — day-1 empty state", () => {
  it("renders <DashboardEmptyOnboarding> in the empty-state branch", () => {
    expect(pageSource).toContain("<DashboardEmptyOnboarding");
  });

  it("references isDayOneEmpty for the empty-state predicate", () => {
    expect(pageSource).toContain("isDayOneEmpty");
  });
});

// ─── Filesystem — retired files must be deleted ────────────────────

describe("retired components are deleted from disk", () => {
  it.each([
    "share-link-card.tsx",
    "quick-actions.tsx",
    "kpi-strip.tsx",
    "__tests__/quick-actions-pills.test.ts",
  ])("does not exist: today/%s", (rel) => {
    expect(existsSync(join(TODAY_DIR, rel))).toBe(false);
  });
});

describe("revenue-trend.tsx moved to revenue/ directory", () => {
  it("no longer exists in dashboard/today/", () => {
    expect(existsSync(join(TODAY_DIR, "revenue-trend.tsx"))).toBe(false);
  });

  it("now exists in dashboard/revenue/", () => {
    expect(existsSync(join(REVENUE_DIR, "revenue-trend.tsx"))).toBe(true);
  });
});
