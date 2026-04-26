import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// DashboardSubTab — top-level Story 04 component. It takes a
// `dashboard` prop (the shape returned by projectRoom.dashboard) and
// dispatches to the 5 module components + meta sidebar. Per CLAUDE.md
// test convention, we pin the contract via:
//   1. Source-text grep on the .tsx file
//   2. The pure helpers it composes (covered in dashboard-helpers.test.ts)
//
// We do NOT render with RTL (no jsdom in this repo).

const SRC = readFileSync(
  new URL("../../sub-tabs/dashboard-sub-tab.tsx", import.meta.url),
  "utf8",
);

describe("DashboardSubTab source invariants (Story 04)", () => {
  it("imports the 5 focal-column modules", () => {
    expect(SRC).toMatch(/HeaderStrip/);
    expect(SRC).toMatch(/LatestVersionStrip/);
    expect(SRC).toMatch(/WhatsNext/);
    expect(SRC).toMatch(/RecentActivityFeed/);
    expect(SRC).toMatch(/OpenCommentsList/);
  });

  it("imports the MetaSidebar", () => {
    expect(SRC).toMatch(/MetaSidebar/);
  });

  it("does NOT use @trpc/react-query / useQuery (server-fetch pattern)", () => {
    // The actual data is fetched server-side via caller.projectRoom.
    // dashboard in page.tsx; this component is a pure-render of the
    // resulting payload.
    expect(SRC).not.toMatch(/@trpc\/react-query/);
    expect(SRC).not.toMatch(/useQuery\(/);
    expect(SRC).not.toMatch(/trpc\..*\.useQuery/);
  });

  it("takes a `dashboard` prop (the procedure return shape)", () => {
    // The shape is `DashboardData` — a type alias for the procedure's
    // inferred return type — so the component composes without
    // re-declaring 12 fields manually.
    expect(SRC).toMatch(/dashboard\??:\s*DashboardData|dashboard:\s*DashboardData/);
  });

  it("uses CSS Grid for focal column + meta sidebar layout", () => {
    // Mobile-first single column → desktop 7/12 + 5/12 split.
    expect(SRC).toMatch(/grid/);
    expect(SRC).toMatch(/lg:/);
  });

  it("does NOT use raw hex colours (CSS-vars-only)", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("does NOT use bg-blue-500 / text-red-600 / Tailwind named colours", () => {
    // Loose check: arbitrary CSS vars are allowed (`bg-[rgb(var(...))]`)
    // but the named colour palette is not.
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("aside has sticky-top on lg breakpoint (right-rail behaviour)", () => {
    expect(SRC).toMatch(/lg:sticky/);
  });

  it("references projectId — passed to LatestVersionStrip + OpenCommentsList for jump links", () => {
    expect(SRC).toMatch(/projectId/);
  });
});

// Page-wiring invariant: page.tsx must invoke caller.projectRoom.
// dashboard so the procedure's payload reaches the component.
const PAGE_SRC = readFileSync(
  new URL(
    "../../../../../app/(app)/dashboard/projects/[id]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("page.tsx invariant — projectRoom.dashboard is wired", () => {
  it("calls caller.projectRoom.dashboard({ projectId })", () => {
    expect(PAGE_SRC).toMatch(/caller\.projectRoom\.dashboard/);
  });

  it("passes the dashboard payload into <DashboardSubTab/>", () => {
    // Either via a prop named `dashboard` directly or by spreading the
    // payload into the component's props record.
    expect(PAGE_SRC).toMatch(/DashboardSubTab[\s\S]{0,200}dashboard/);
  });
});
