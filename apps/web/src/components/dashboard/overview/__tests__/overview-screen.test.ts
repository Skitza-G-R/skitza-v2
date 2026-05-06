import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildSparkPath } from "../overview-screen";

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
