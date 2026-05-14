import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildSparkPath, isFirstWeekEmptyState } from "../overview-screen";

// Overview Polish — pin the design hierarchy + the new public-link
// hero strip + the sparkline math. The component itself renders in a
// node-only Vitest env, so we mix pure-function tests with source-grep
// invariants (the existing Skitza idiom — see page-rebuild.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const OVERVIEW_DIR = join(here, "..");
const overviewSource = readFileSync(join(OVERVIEW_DIR, "overview-screen.tsx"), "utf8");
const linkStripSource = readFileSync(
  join(OVERVIEW_DIR, "public-link-strip.tsx"),
  "utf8",
);

// ─── buildSparkPath — pure SVG path builder ────────────────────────

describe("buildSparkPath", () => {
  it("returns empty string for empty input", () => {
    expect(buildSparkPath([])).toBe("");
  });

  it("returns empty string when every value is zero", () => {
    // A flat baseline reads as a chart, which is misleading. The
    // component hides the SVG entirely in that case.
    expect(buildSparkPath([0, 0, 0, 0])).toBe("");
  });

  it("returns a non-empty path for mixed values", () => {
    const path = buildSparkPath([1, 2, 3, 2, 1]);
    expect(path).toMatch(/^M/);
    expect(path).toContain("L");
  });

  it("starts with an M command and uses L for subsequent points", () => {
    const path = buildSparkPath([10, 20, 15]);
    expect(path.startsWith("M")).toBe(true);
    expect(path.split(" ").length).toBe(3); // 1 M + 2 L
  });

  it("places the highest value at the top (smallest Y)", () => {
    // viewBox is 100x22 with PAD=2, so plotH = 18. Max value should
    // land at y = PAD = 2.
    const path = buildSparkPath([0, 0, 100, 0, 0]);
    // Find the y-coord of the third point — the max.
    const tokens = path.split(" ");
    const maxToken = tokens[2];
    // Parse "L<x>,<y>"
    const m = /[ML]([\d.]+),([\d.]+)/.exec(maxToken ?? "");
    expect(m).not.toBeNull();
    if (m) {
      const y = parseFloat(m[2] ?? "0");
      expect(y).toBeCloseTo(2, 1);
    }
  });

  it("handles a 30-bucket array (the producer.today shape)", () => {
    const buckets: number[] = Array.from({ length: 30 }, (_, i) => i + 1);
    const path = buildSparkPath(buckets);
    // 30 points -> 1 M + 29 L -> 30 tokens total (space-joined).
    expect(path.split(" ").length).toBe(30);
  });
});

// ─── isFirstWeekEmptyState — pure predicate ────────────────────────
//
// Detects the "completely fresh producer" state where every signal on
// the Overview is empty. Used to swap the standard layout for a single
// FirstWeekPanel so a new producer doesn't see 3 stacked "all clear"
// messages on day 1.
//
// Returns true ONLY when:
//   - thisMonthCents === 0           (no income yet)
//   - activityCount === 0            (no events at all)
//   - urgentCount === 0              (no urgent projects)
//   - hasTodaySession === false      (no session today)
//   - pendingApprovalsCount === 0    (no booking requests)
//
// Any one positive signal flips it to false — even a single pending
// approval means "you have something to do", not first week.

describe("isFirstWeekEmptyState", () => {
  const base = {
    thisMonthCents: 0,
    activityCount: 0,
    urgentCount: 0,
    hasTodaySession: false,
    pendingApprovalsCount: 0,
  };

  it("returns true when every signal is empty", () => {
    expect(isFirstWeekEmptyState(base)).toBe(true);
  });

  it("returns false when the producer has earned money this month", () => {
    expect(isFirstWeekEmptyState({ ...base, thisMonthCents: 1 })).toBe(false);
  });

  it("returns false when there is any activity", () => {
    expect(isFirstWeekEmptyState({ ...base, activityCount: 1 })).toBe(false);
  });

  it("returns false when there are urgent projects", () => {
    expect(isFirstWeekEmptyState({ ...base, urgentCount: 1 })).toBe(false);
  });

  it("returns false when a session is scheduled for today", () => {
    expect(isFirstWeekEmptyState({ ...base, hasTodaySession: true })).toBe(false);
  });

  it("returns false when a booking request is waiting for approval", () => {
    expect(isFirstWeekEmptyState({ ...base, pendingApprovalsCount: 1 })).toBe(false);
  });

  it("returns false when multiple positive signals are present", () => {
    expect(
      isFirstWeekEmptyState({
        thisMonthCents: 50_000,
        activityCount: 3,
        urgentCount: 1,
        hasTodaySession: true,
        pendingApprovalsCount: 2,
      }),
    ).toBe(false);
  });

  it("treats negative thisMonthCents as non-empty (refunds count as activity)", () => {
    // A refund or chargeback still means the producer has financial
    // history this month — don't show first-week panel.
    expect(isFirstWeekEmptyState({ ...base, thisMonthCents: -1 })).toBe(false);
  });
});

// ─── Source-grep — overview-screen.tsx hierarchy ───────────────────

describe("OverviewScreen — design-aligned hierarchy", () => {
  it("renders the greeting block with the 'Accepting Sessions' pill", () => {
    expect(overviewSource).toContain("Accepting Sessions");
    expect(overviewSource).toMatch(/pill\s+pill-success/);
  });

  it("renders the PublicLinkStrip when slug is set", () => {
    expect(overviewSource).toContain("<PublicLinkStrip");
    expect(overviewSource).toContain("slug ?");
  });

  it("renders the Financial Pulse card with a sparkline path", () => {
    expect(overviewSource).toContain("Financial pulse");
    expect(overviewSource).toContain("buildSparkPath(pulseStats.sparkline)");
  });

  it("renders the Urgent card from the project-level urgentProjects prop", () => {
    // Project-level urgent (replaced the today.items filter): the
    // Urgent card now consumes pre-classified project rows with a
    // colored urgency pill (overdue / deposit_due / stuck) and a
    // green-check empty state.
    expect(overviewSource).toContain("urgentProjects: Array<");
    expect(overviewSource).toContain("<UrgentCard projects={urgentProjects} />");
    expect(overviewSource).toMatch(/urgency:\s*"overdue"\s*\|\s*"deposit_due"\s*\|\s*"stuck"/);
  });

  it("renders the Recent Uploads card with PlayCircle + uploaded-relative + duration", () => {
    expect(overviewSource).toContain("Recent uploads");
    expect(overviewSource).toContain("<PlayCircleIcon />");
    expect(overviewSource).toContain("formatRelativeTime(u.uploadedAt, now)");
    expect(overviewSource).toContain("formatDuration(u.durationMs)");
  });

  it("imports the new slug + recentUploads contract on the props type", () => {
    expect(overviewSource).toMatch(/slug:\s*string\s*\|\s*null;/);
    expect(overviewSource).toMatch(/recentUploads:\s*Array</);
    // 2026-05-06: `publicBaseUrl` removed — PublicLinkStrip now reads
    // the canonical brand origin from `~/lib/share/public-url`, so
    // OverviewScreen no longer threads the env-driven origin through.
    expect(overviewSource).not.toMatch(/publicBaseUrl:\s*string;/);
  });

  it("calls isFirstWeekEmptyState to detect the all-empty state", () => {
    // Wired in OverviewScreen — the predicate decides whether to swap
    // the standard 4-card layout for the single FirstWeekPanel.
    expect(overviewSource).toMatch(/isFirstWeekEmptyState\(\s*\{/);
  });

  it("defines the FirstWeekPanel component", () => {
    expect(overviewSource).toMatch(/function FirstWeekPanel\(/);
  });

  it("renders <FirstWeekPanel /> conditionally on the first-week predicate", () => {
    // Pin the conditional render — a future refactor that drops the
    // branch (e.g., "always render FirstWeekPanel") would defeat the
    // whole point of the design (only fires day 1).
    expect(overviewSource).toContain("<FirstWeekPanel");
  });

  it("FirstWeekPanel surfaces a 'share your link' CTA", () => {
    // The whole funnel hinges on the public link. The first-week panel
    // must include a path to that action even though the PublicLinkStrip
    // already exists above it — this is the design's reinforced focus
    // when everything else is empty.
    expect(overviewSource).toMatch(/Share your link|Copy your link|public link/i);
  });

  it("FirstWeekPanel offers a 'see what artists see' preview link", () => {
    // The /join/<slug> preview is the second priority CTA. Pin the
    // href pattern so a refactor doesn't accidentally drop it.
    expect(overviewSource).toMatch(/\/join\/\$\{slug\}/);
  });

  it("FirstWeekPanel's Share CTA opens a WhatsApp deep link (not a generic dashboard page)", () => {
    // Audit followup 2026-05-14: the original "Share your link" CTA
    // routed to /dashboard/profile — vague, and duplicated the Copy
    // button already visible in PublicLinkStrip above. The real day-1
    // share action is a one-click WhatsApp deep link. wa.me/?text=
    // opens WhatsApp Web on desktop and the app on mobile, lets the
    // producer pick the recipient, and pre-fills an editable message.
    expect(overviewSource).toMatch(/wa\.me\/\?text=/);
    // The slug must be threaded into the shared message so the link
    // actually points at the producer's /join page.
    expect(overviewSource).toContain("buildJoinUrl(slug)");
  });

  it("FirstWeekPanel's preview link opens in a new tab (target=_blank)", () => {
    // Previewing the /join page from inside the dashboard shouldn't
    // navigate the producer away from their work. New tab preserves
    // their place. Pin both the target attribute + the value, and
    // the noopener/noreferrer rel pair (security best practice for
    // any externally-pointing _blank link).
    //
    // We pin both forms (static "target='_blank'" + the JSX-expr
    // "target={cond ? '_blank' : undefined}") so a refactor either
    // way satisfies the invariant.
    expect(overviewSource).toMatch(/target=(?:"_blank"|\{[^}]*"_blank")/);
    expect(overviewSource).toMatch(/rel=(?:"noopener noreferrer"|\{[^}]*"noopener noreferrer")/);
  });

  it("FirstWeekPanel's 'Polish' CTA goes to /dashboard/portfolio (not a duplicate of profile)", () => {
    // Portfolio is the highest-impact conversion lever for a fresh
    // producer — artists need to hear the work to book. Pin the
    // route so a refactor doesn't collapse two CTAs onto /profile.
    expect(overviewSource).toContain('href="/dashboard/portfolio"');
  });

  it("hides UrgentCard, RecentUploadsCard, FinancialPulseCard, and Activity in first-week mode", () => {
    // When the FirstWeekPanel takes over, the four "empty" cards
    // (Urgent, Recent, Financial, Activity) must NOT also render —
    // otherwise we still get the "stacked all clear" problem.
    // We pin this by requiring the renders to live under the `!isFirstWeek`
    // branch (the else of the conditional).
    expect(overviewSource).toMatch(/isFirstWeek\s*\?\s*\(?\s*</);
    // The else-branch uses a JSX fragment to bundle all the standard
    // sections (with or without the optional paren wrapper that
    // multi-line JSX expressions usually need).
    expect(overviewSource).toMatch(/:\s*\(?\s*<>/);
  });

  it("collapses Urgent + Recent into full-width Recent when Urgent is empty", () => {
    // Audit finding (2026-05-14): when urgentProjects.length === 0
    // AND recentTop has items, the standard 2-up grid pairs a stubby
    // "Nothing urgent" card (~80px) with a tall Recent Uploads card
    // (~280px) — dedicating 50% of the viewport to a green-check pill.
    //
    // The collapse demotes the empty Urgent card entirely in that
    // specific combo and lets RecentUploadsCard take the full row.
    // (Urgent-empty + Recent-empty still shows the green-check
    // empty state — that's the "you have projects, nothing urgent"
    // signal. Urgent-has + Recent-empty also stays as-is.)
    expect(overviewSource).toMatch(/useFullWidthRecent\s*=/);
    expect(overviewSource).toMatch(/useFullWidthRecent\s*\?/);
    // The predicate is the urgent-is-empty + recent-has-items combo.
    expect(overviewSource).toMatch(/urgentProjects\.length\s*===\s*0/);
    expect(overviewSource).toMatch(/recentTop\.length\s*>\s*0/);
  });

  it("does not render a top-right date chip (OS chrome shows the date)", () => {
    // Audit 2026-05-14: the right-side "May 14, 2026" chip duplicated
    // info already visible in the producer's browser/OS clock. It
    // competed with the "Accepting Sessions" pill for visual weight
    // in the hero row. Dropping it tightens the greeting block.
    //
    // We pin both the call site and the now-unused helper definitions
    // to make sure a future refactor doesn't accidentally bring it
    // back. If a date stamp is needed again, embed it in the Activity
    // or Financial Pulse section header, not the hero row.
    expect(overviewSource).not.toContain("formatTopDate(now)");
    expect(overviewSource).not.toMatch(/function formatTopDate\b/);
    expect(overviewSource).not.toMatch(/function ClockIcon\b/);
  });

  it("does NOT use Tailwind color literals (bg-blue-500, text-red-600, etc)", () => {
    // CSS-variable discipline — design tokens only.
    expect(overviewSource).not.toMatch(/bg-(red|blue|green|yellow|orange|purple)-\d{2,3}/);
    expect(overviewSource).not.toMatch(
      /text-(red|blue|green|yellow|orange|purple)-\d{2,3}/,
    );
    // No literal hex codes either.
    expect(overviewSource).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

// ─── Source-grep — public-link-strip.tsx ───────────────────────────

describe("PublicLinkStrip — dark hero card", () => {
  it("is a client component", () => {
    expect(linkStripSource.startsWith('"use client"')).toBe(true);
  });

  it("renders the dark sidebar background (no hex, just tokens)", () => {
    expect(linkStripSource).toContain("bg-[rgb(var(--bg-sidebar))]");
    expect(linkStripSource).toContain("border-[rgb(var(--border-sidebar))]");
  });

  it("includes the animate-shine overlay", () => {
    expect(linkStripSource).toContain("animate-shine");
  });

  it("renders a Copy button that flips to 'Copied' when copied is true", () => {
    expect(linkStripSource).toMatch(/copied \? "Copied" : "Copy"/);
  });

  it("uses the brand-primary token for the un-copied button background", () => {
    expect(linkStripSource).toContain("bg-[rgb(var(--brand-primary))]");
  });

  it("uses the fg-success token for the copied state", () => {
    expect(linkStripSource).toContain("bg-[rgb(var(--fg-success))]");
  });

  it("constructs the URL via buildJoinUrl from ~/lib/share/public-url", () => {
    // 2026-05-06: the prior version pinned `${base}/p/${slug}` — that
    // path is the deprecated /p/ route (PRD §6.6 / Story 03 deletion)
    // which 404s. The strip's "Copy" button was therefore copying a
    // broken URL on every producer's dashboard. Pin the canonical
    // helper now so a future refactor can't reintroduce either bug
    // (wrong path OR env-driven base URL).
    expect(linkStripSource).toContain("buildJoinUrl(slug)");
    expect(linkStripSource).toContain('from "~/lib/share/public-url"');
  });

  it("does NOT reference the deprecated /p/ path", () => {
    // /p/<slug> was removed in Story 03 (PRD §6.6). Pin so a redesign
    // that re-derives the link from a layout file can't regress here.
    expect(linkStripSource).not.toMatch(/\/p\/\$\{/);
  });

  it("does NOT thread an env-driven publicBaseUrl prop anymore", () => {
    // Producer share links must be brand-canonical regardless of the
    // deployment env (NEXT_PUBLIC_SITE_URL / SITE_URL might point at
    // a Vercel preview host in misconfigured envs). The component
    // reads the canonical origin directly from the helper module.
    expect(linkStripSource).not.toContain("publicBaseUrl: string");
  });

  it("does NOT use Tailwind color literals", () => {
    expect(linkStripSource).not.toMatch(/bg-(red|blue|green|yellow|orange|purple)-\d{2,3}/);
    expect(linkStripSource).not.toMatch(
      /text-(red|blue|green|yellow|orange|purple)-\d{2,3}/,
    );
    expect(linkStripSource).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

// ─── Filesystem — new files exist ──────────────────────────────────

describe("Overview Polish files exist", () => {
  it("public-link-strip.tsx is present", () => {
    expect(existsSync(join(OVERVIEW_DIR, "public-link-strip.tsx"))).toBe(true);
  });

  it("overview-screen.tsx is present", () => {
    expect(existsSync(join(OVERVIEW_DIR, "overview-screen.tsx"))).toBe(true);
  });
});
