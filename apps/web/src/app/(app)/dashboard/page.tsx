import fs from "node:fs/promises";
import path from "node:path";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

// gili/design-test branch — full Claude Design mockup served inside an
// iframe at /dashboard, with real producer data injected server-side.
//
// Why iframe: the mockup is a self-contained 5598-line single-file React
// app (Babel-in-browser, inline <style>, internal tab routing, audio
// player, Cmd-K palette, drill-downs, animations). Translating each
// component to .tsx with Next.js routing fragments the design surface
// and was already drifting on Overview alone. iframe + srcDoc preserves
// the mockup byte-for-byte and lets every tab + every interaction work
// exactly as designed.
//
// Real-data injection: a `<script>` tag inserted right before </head>
// installs an `Object.defineProperty` setter on `window.SAMPLE_DATA`.
// When the mockup's data.jsx script runs `window.SAMPLE_DATA = SAMPLE_DATA`,
// the setter intercepts, deep-merges our overrides (real producer name +
// slug + earned $, real projects, real recent uploads), and reinstalls
// the merged value as a regular property. All subsequent components see
// merged data.
//
// Hardcoded user values not in SAMPLE_DATA (e.g., the literal `"Good
// morning, Gili."` H1 string) are patched via plain string replacement
// on the HTML before serving.
//
// Throwaway sandbox — never merges to main.

// ─── Stage → mockup tag/tagType ──────────────────────────────────────
function tagForStage(stage: string): {
  label: string;
  type: "danger" | "warning" | "neutral" | "success" | "brand";
} {
  switch (stage) {
    case "payment_paused":
      return { label: "PAYMENT PAUSED", type: "danger" };
    case "cancelled":
      return { label: "CANCELLED", type: "danger" };
    case "final_review":
      return { label: "ACTION NEEDED", type: "warning" };
    case "contract_sent":
      return { label: "AWAITING SIGN", type: "warning" };
    case "in_production":
      return { label: "IN PROGRESS", type: "neutral" };
    case "booked":
      return { label: "BOOKED", type: "brand" };
    case "lead":
      return { label: "LEAD", type: "neutral" };
    case "paid":
      return { label: "PAID", type: "success" };
    case "archived":
      return { label: "COMPLETE", type: "success" };
    default:
      return { label: stage.toUpperCase(), type: "neutral" };
  }
}

function humanStage(stage: string): string {
  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function progressForStage(stage: string): number {
  switch (stage) {
    case "lead":
      return 5;
    case "booked":
      return 15;
    case "contract_sent":
      return 25;
    case "in_production":
      return 60;
    case "final_review":
      return 90;
    case "paid":
    case "archived":
      return 100;
    case "payment_paused":
      return 50;
    case "cancelled":
      return 30;
    default:
      return 50;
  }
}

const GRAD_PALETTE = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-violet",
  "grad-indigo",
  "grad-emerald",
  "grad-sky",
] as const;

function gradFor(idx: number): string {
  return GRAD_PALETTE[idx % GRAD_PALETTE.length] ?? "grad-amber";
}

function relTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  const hr = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${String(min)}m ago`;
  if (hr < 24) return `${String(hr)}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${String(days)}d ago`;
  if (days < 30) return `${String(Math.floor(days / 7))}w ago`;
  return `${String(Math.floor(days / 30))}mo ago`;
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "--:--";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function firstNameOf(displayName: string | null): string {
  if (!displayName) return "there";
  const trimmed = displayName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function initialsOf(displayName: string | null): string {
  if (!displayName) return "GS";
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "GS";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Escape a string so it can be safely embedded inside a `<script>` tag.
// Two concerns: (1) prematurely closing the script via `</script>`; (2) the
// HTML parser treating `<!--` / `-->` as a comment and swallowing JSON. The
// trick used by html-webpack-plugin et al. is to escape any `<` that
// precedes `script`, `/script`, or `!`.
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\/(script|!)/g, "<\\/$1");
}

// HTML-attribute-safe escaping. We're embedding inline strings in places
// the browser parses as text, so the standard 5 characters cover us.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape a string so it can safely appear inside a single-quoted JS
// literal embedded in the mockup HTML (used for `'Gili Studio'` swaps).
function escapeJsSingleQuoted(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [today, me, projectsList] = await Promise.all([
    caller.producer.today(),
    caller.producer.me(),
    caller.project.list(),
  ]);

  const realName = me.displayName ?? "Your Studio";
  const firstName = firstNameOf(me.displayName);
  const initials = initialsOf(me.displayName);
  const slug = me.slug ?? "your-slug";
  const fullPublicLink = `skitza.app/p/${slug}`;
  const earnedMonth = Math.round(today.pulseStats.thisMonthCents / 100);
  const earnedDelta = today.pulseStats.deltaPct ?? 0;

  // Map real projects → mockup project shape. Mockup expects every field
  // in SAMPLE_DATA.projects[] for full sub-tab coverage (Project Room
  // reads progress, sessions, paid, total, songs). We synthesize sensible
  // defaults for fields the DB doesn't track yet (those are mock-data
  // territory we deliberately skip per the "wire what's available" brief).
  const realProjects = projectsList.map((p, i) => {
    const stageTag = tagForStage(p.stage);
    return {
      id: p.id,
      clientId: `client-${String(i)}`,
      name: p.title,
      client: p.clientName ?? p.artistName ?? "Client",
      status: humanStage(p.stage),
      stage:
        p.stage === "in_production"
          ? "production"
          : p.stage === "final_review"
            ? "review"
            : p.stage === "archived" || p.stage === "paid"
              ? "delivered"
              : p.stage === "lead"
                ? "intro"
                : p.stage,
      progress: progressForStage(p.stage),
      tag: stageTag.label,
      tagType: stageTag.type,
      deadline: "—",
      deadlineDays: 0,
      grad: gradFor(i),
      sessions: 0,
      paid: 0,
      total: 0,
      songs: 0,
    };
  });

  const realTracks = today.recentUploads.map((u, i) => ({
    id: u.versionId,
    title: u.title,
    project: u.projectClientName || "Project",
    projectId: u.projectId,
    client: "",
    version: u.versionLabel,
    versions: [u.versionLabel],
    comments: u.unreadComments,
    plays: 0,
    duration: fmtDuration(u.durationMs),
    durationSec: u.durationMs ? Math.round(u.durationMs / 1000) : 240,
    bpm: null,
    mkey: null,
    grad: gradFor(i),
    uploaded: relTime(u.uploadedAt),
    uploadedRel: "today",
    favorite: false,
  }));

  const overrides = {
    producer: {
      name: realName,
      initials,
      publicLink: fullPublicLink,
      earnedMonth,
      earnedDelta,
    },
    projects: realProjects,
    tracks: realTracks,
  };

  // Read mockup HTML (~358 KB). The file was committed to public/ in an
  // earlier step; reading from process.cwd() works in Vercel's Node.js
  // runtime. Edge runtime won't have fs, so this page must stay on Node.
  const mockupPath = path.join(
    process.cwd(),
    "apps/web/public/design-test/index.html",
  );
  let html = await fs.readFile(mockupPath, "utf-8");

  // ─── Patch hardcoded user values that aren't in SAMPLE_DATA ─────────
  // Mockup line 1455: `<h1 ...>Good morning, Gili.</h1>` — hardcoded.
  html = html.replaceAll(
    "Good morning, Gili.",
    `Good morning, ${escapeHtml(firstName)}.`,
  );
  // Mockup line 1348: `<span ...>gili</span>` — hardcoded slug in the
  // public-link strip. Anchored via the closing tag to avoid catching
  // unrelated `gili` substrings (e.g., 'gilistudio' on socialLinks).
  html = html.replaceAll(
    ">gili</span>",
    `>${escapeHtml(slug)}</span>`,
  );
  // Settings tab + Storefront tab inline literals.
  html = html.replaceAll(
    "'Gili Studio'",
    `'${escapeJsSingleQuoted(realName)}'`,
  );
  html = html.replaceAll(
    "'skitza.app/p/gili'",
    `'${escapeJsSingleQuoted(fullPublicLink)}'`,
  );
  // Mockup line 3411 + 3506 + 3939: `producer.slug || 'gili'` fallback.
  html = html.replaceAll(
    "producer.slug || 'gili'",
    `producer.slug || '${escapeJsSingleQuoted(slug)}'`,
  );

  // ─── Inject SAMPLE_DATA setter ──────────────────────────────────────
  // The setter intercepts the mockup's `window.SAMPLE_DATA = SAMPLE_DATA`
  // assignment, deep-merges our overrides, and reinstalls as a regular
  // property. All other script blocks read from window.SAMPLE_DATA, so
  // every consumer sees merged data.
  const overridesJson = safeJsonForScript(overrides);
  const injection = `
<script>
  (function () {
    var __overrides = ${overridesJson};
    function __merge(base) {
      return Object.assign({}, base, {
        producer: Object.assign({}, base.producer, __overrides.producer || {}),
        projects: (__overrides.projects && __overrides.projects.length) ? __overrides.projects : base.projects,
        tracks: (__overrides.tracks && __overrides.tracks.length) ? __overrides.tracks : base.tracks
      });
    }
    Object.defineProperty(window, 'SAMPLE_DATA', {
      configurable: true,
      set: function (v) {
        var merged = __merge(v);
        Object.defineProperty(window, 'SAMPLE_DATA', {
          value: merged, writable: true, configurable: true, enumerable: true
        });
      },
      get: function () { return undefined; }
    });
  })();
</script>
`;
  html = html.replace("</head>", `${injection}</head>`);

  return (
    <iframe
      title="Skitza Design Preview"
      srcDoc={html}
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-clipboard-write"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: 0,
        margin: 0,
        padding: 0,
      }}
    />
  );
}
