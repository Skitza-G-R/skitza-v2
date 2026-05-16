import type { Metadata } from "next";
import Link from "next/link";

import generatedChangelog from "./entries.generated.json";

// Changelog — two sections:
//
// 1. "Recent changes" — auto-generated from `git log main` via
//    `pnpm -F web changelog:regen` or the GitHub Action at
//    `.github/workflows/changelog-update.yml`. Rendered from
//    `entries.generated.json`. Groups commits by date; shows
//    feat:/perf: as "new" and fix: as "fixes".
//
// 2. "Major releases" — the hand-curated v0.x releases below.
//    These summarize sprint-level themes (Phase A–B, Phase C–F,
//    Phase G, landing-v2) that are more than a single commit can
//    capture. Updated by hand when a meaningful release lands.
//
// 2026-04-22 — audit Task 8 (overnight Task D). Previously this
// page was fully hand-seeded; drift risk on every release. Now the
// per-commit log is automated while the narrative release notes
// stay manual.

// Shape of the generated JSON. Matches scripts/generate-changelog.mjs.
type GeneratedEntry = {
  date: string;
  items: Array<{
    hash: string;
    kind: "new" | "fix";
    scope: string | null;
    title: string;
  }>;
};
type GeneratedChangelog = {
  generatedAt: string;
  source: string;
  entries: GeneratedEntry[];
};

const generated = generatedChangelog as GeneratedChangelog;

// Cap the displayed date groups to keep the page scrollable. Older
// changes are still in git history + accessible via GitHub commit log.
const MAX_RECENT_DATES = 12;
const recentEntries = generated.entries.slice(0, MAX_RECENT_DATES);

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Everything we've shipped to Skitza — audio library, CRM, booking, contracts, and the producer workflow behind them.",
  alternates: { canonical: "/changelog" },
  robots: { index: true, follow: true },
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Changelog
      </p>
      <h1
        className="mt-3 font-display text-5xl leading-[0.98] tracking-tight sm:text-6xl"
        style={{ fontVariationSettings: '"opsz" 144', fontWeight: 800 }}
      >
        What we shipped.
        <span className="block italic text-[rgb(var(--brand-primary))]">
          Newest first.
        </span>
      </h1>
      <p className="mt-6 text-lg text-[rgb(var(--fg-secondary))]">
        Skitza is built in public. Every release we ship, big or small, lands here.
        You can also follow the GitHub tags for the full commit trail.
      </p>

      {/* Recent changes — auto-generated from git */}
      {recentEntries.length > 0 ? (
        <section className="mt-14" aria-labelledby="recent-changes">
          <h2
            id="recent-changes"
            className="font-display text-3xl tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Recent changes
          </h2>
          <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">
            Auto-generated from git history. Showing the last {MAX_RECENT_DATES}{" "}
            day(s) with commits.
          </p>
          <ol className="mt-6 space-y-6">
            {recentEntries.map((entry) => (
              <li
                key={entry.date}
                className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
              >
                <time
                  dateTime={entry.date}
                  className="font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
                >
                  {entry.date}
                </time>
                <ul className="mt-3 space-y-1.5">
                  {entry.items.map((item) => (
                    <li
                      key={item.hash}
                      className="flex items-start gap-2 text-sm text-[rgb(var(--fg-primary))]"
                    >
                      <span
                        aria-hidden
                        className={`mt-1 rounded-[var(--radius-lg)] px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider ${
                          item.kind === "fix"
                            ? "bg-[rgb(var(--fg-danger)/0.12)] text-[rgb(var(--fg-danger))]"
                            : "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
                        }`}
                      >
                        {item.kind}
                      </span>
                      <span className="flex-1">
                        {item.scope ? (
                          <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
                            {item.scope}:{" "}
                          </span>
                        ) : null}
                        {item.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <h2
        id="major-releases"
        className="mt-16 font-display text-3xl tracking-tight"
        style={{ fontWeight: 700 }}
      >
        Major releases
      </h2>
      <p className="mt-2 text-sm text-[rgb(var(--fg-muted))]">
        Curated sprint-level highlights.
      </p>
      <div className="mt-6 space-y-14">
        {RELEASES.map((r) => (
          <article
            key={r.version}
            className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-7"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[rgb(var(--border-subtle))] pb-4">
              <h2
                className="font-display text-2xl tracking-tight"
                style={{ fontWeight: 700 }}
              >
                {r.version}
                <span className="ml-3 font-mono text-sm font-normal text-[rgb(var(--fg-muted))]">
                  {r.codename}
                </span>
              </h2>
              <time
                dateTime={r.date}
                className="font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
              >
                {r.date}
              </time>
            </header>
            <p className="mt-4 text-[rgb(var(--fg-secondary))]">{r.summary}</p>
            <ul className="mt-5 space-y-2">
              {r.items.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-sm text-[rgb(var(--fg-primary))]"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="mt-16 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-8 text-center">
        <h2
          className="font-display text-2xl tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Ready to try it?
        </h2>
        <p className="mt-2 text-[rgb(var(--fg-secondary))]">
          Free forever. No card. Your URL is yours the minute you sign up.
        </p>
        <Link
          href="/sign-up"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-7 py-3 text-sm font-semibold text-[#0C0A07] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.35)]"
        >
          Start free →
        </Link>
      </div>
    </main>
  );
}

// Seeded from the Phase G → Phase C→F work; update by hand for now.
// When the changelog gets long enough, swap this for MDX + a generator
// pass over git tags.
const RELEASES: readonly {
  version: string;
  codename: string;
  date: string;
  summary: string;
  items: readonly string[];
}[] = [
  {
    version: "v0.4",
    codename: "landing-v2",
    date: "2026-04-18",
    summary:
      "Production-grade homepage: new nav, download section, compare table, FAQ, security, founder note, and footer. Every CTA now routes to sign-up or the Mac DMG.",
    items: [
      "Landing rebuilt: hero, trust bar, compare, security, FAQ, founder, footer",
      "Pricing refreshed with Free / Pro / Studio tiers and monthly/annual toggle",
      "Download section wired to GitHub Releases — macOS live, others flagged 'coming soon'",
      "Waitlist form retired; /changelog route created",
    ],
  },
  {
    version: "v0.3",
    codename: "Phase G",
    date: "2026-04-18",
    summary:
      "Studio-grade feature drop: audio library with persistent player, clients CRM, onboarding wizard, booking v2, and portfolio embeds.",
    items: [
      "Audio library with persistent player (Samply-style layout)",
      "Clients CRM with one-click magic-link send",
      "Booking v2: service kinds, buffers, blackout dates, session packs",
      "Onboarding wizard + dashboard stats + revenue tile",
      "Portfolio URL embeds (Spotify / SoundCloud / YouTube / Apple)",
      "Track-approval → stems-request automation",
      "-52% First Load on contract signer, -47% on contract editor",
    ],
  },
  {
    version: "v0.2",
    codename: "Phase C–F",
    date: "2026-04-17",
    summary:
      "Producer workspace matures: brand settings, magic-link analytics, accessibility pass, rate limiting, data export, dark mode, error boundaries.",
    items: [
      "Producer onboarding + brand settings",
      "Public portfolio at /p/<you> (retired in Story 03; see /join/<you>)",
      "Smart lead links (magic URL + open / dwell / referrer analytics)",
      "Next-themes dark mode + warm-cream light mode",
      "A11y pass, in-memory rate limiting, one-click data export",
      "Error boundaries, skeletons, QR code, audio player",
    ],
  },
  {
    version: "v0.1",
    codename: "Phase A–B",
    date: "2026-04-15",
    summary:
      "Initial landing shell, Clerk auth, Drizzle DB, and the Skitza visual identity (warm cream + amber + copper).",
    items: [
      "Marketing landing v1 with waitlist form",
      "Clerk auth + Drizzle + first Neon schema",
      "Brand tokens: warm cream, amber primary, copper accent",
      "Fraunces / Outfit / JetBrains Mono typography stack",
    ],
  },
];
