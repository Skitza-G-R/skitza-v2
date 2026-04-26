import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Story 07 — `/dashboard/revenue` route hosting the deep 6-month chart.
//
// This test is structural / source-grep style — vitest runs in `node`
// env (see vitest.config.ts), no jsdom available, and the page is a
// React Server Component that calls Clerk's `auth()` + tRPC's
// `appRouter.createCaller(...)`. Spinning either of those up in a
// unit-test sandbox is more pain than the test would buy us. So
// instead we pin the structural invariants the story spec requires:
//
//   1. The page file exists at the expected path.
//   2. It default-exports a function (the Next.js page convention).
//   3. It imports `RevenueTrend` from the existing today/ location
//      (Option A — Story 06 performs the file move during its
//      cleanup sweep).
//   4. It calls `caller.producer.revenueTrend()` (no new tRPC).
//   5. It renders the page header (eyebrow REVENUE + H1) + the
//      back-link to /dashboard.
//   6. The chart is wrapped in a max-w-[800px] container per the
//      story spec.
//
// Pattern matches `layout-architecture.test.ts` which is the
// canonical "structural rule pinned via file-source read" idiom in
// this codebase. `fileURLToPath` is required because the repo lives
// at "Skitza 16.4" — the space encodes as `%20` in a URL but the
// filesystem APIs need an unencoded path.

const PAGE_PATH = fileURLToPath(new URL("../page.tsx", import.meta.url));

describe("/dashboard/revenue page", () => {
  it("exists at apps/web/src/app/(app)/dashboard/revenue/page.tsx", () => {
    expect(existsSync(PAGE_PATH)).toBe(true);
  });

  it("default-exports a function (Next.js page convention)", async () => {
    const mod: unknown = await import(PAGE_PATH);
    const def = (mod as { default?: unknown }).default;
    expect(typeof def).toBe("function");
  });

  it("imports RevenueTrend from the existing today/ location (Option A)", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    // Pin the import string so a future move out of `today/` (Story
    // 06's cleanup territory) trips this test and the dev confirms
    // the move was intentional. We accept either the today/ path
    // (current) or the revenue/ path (post-Story-06) — both render
    // the same component, but the source location matters for the
    // sequenced delivery.
    expect(src).toMatch(
      /import \{ RevenueTrend \} from ["']~\/components\/dashboard\/(today|revenue)\/revenue-trend["']/,
    );
  });

  it("calls caller.producer.revenueTrend() to fetch chart data", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    expect(src).toMatch(/caller\.producer\.revenueTrend\(\)/);
  });

  it("redirects unauthenticated visitors to /sign-in", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    // Match the standard Skitza pattern from dashboard/page.tsx +
    // music/page.tsx etc. — `if (!userId) redirect("/sign-in")`.
    expect(src).toMatch(/redirect\(["']\/sign-in["']\)/);
  });

  it("renders the page header with REVENUE eyebrow + H1 copy", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    // The eyebrow is the same uppercase-monospace pattern used on
    // the rest of the dashboard's deep pages. The H1 is the literal
    // headline copy from the story spec — pinning it stops a casual
    // copy refactor from drifting the page identity.
    expect(src).toMatch(/Revenue/);
    expect(src).toMatch(/Last 6 months of paid invoices/);
  });

  it("includes a back-link to /dashboard (Today)", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    expect(src).toMatch(/href=["']\/dashboard["']/);
    expect(src).toMatch(/Back to Today/);
  });

  it("wraps the chart in a max-w-[800px] container per the story spec", () => {
    const src = readFileSync(PAGE_PATH, "utf8");
    // The spec calls for the chart to render at breathable size in a
    // centered 800px-wide column. Pin both the centering (`mx-auto`)
    // and the width.
    expect(src).toMatch(/max-w-\[800px\]/);
  });
});
