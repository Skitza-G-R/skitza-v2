"use client";

// Gradient hero for the Project Room — the "album page" header lifted
// from the 2026-05 reference design. Each project gets a deterministic
// per-id gradient (see lib/projects/gradient.ts) so the workspace feels
// varied without bookmarking jitter. Light text reads on every gradient
// because the six warm-toned stops were picked specifically for white-
// over-color contrast.
//
// Stateless on purpose: the orchestrating ProjectHeader owns stage
// state, kebab open/close, modals, and hotkeys. This component just
// receives the derived strings + callbacks and renders. That keeps the
// hero swap-replaceable without a state migration if the design pivots
// again.

import Link from "next/link";
import type { ReactNode } from "react";

import { useToast } from "~/components/ui/toast";
import type { GradientKey } from "~/lib/projects/gradient";

interface ProjectHeroProps {
  title: string;
  // Eyebrow microcopy above the title — typically "Project · {stage}"
  // (e.g. "Project · In production"). Pre-formatted by the caller so
  // the hero stays presentational.
  eyebrow: string;
  // Inline meta items joined with a center-dot separator. Pre-formatted
  // strings; e.g. ["Acme Records", "3 songs", "2 sessions", "$5,000"].
  meta: string[];
  gradientClass: GradientKey;
  // Deep-link href for "Play latest" (typically the Songs sub-tab).
  // When the project has no tracks, pass null and the button hides.
  playLatestHref: string | null;
  // The 3-dot kebab trigger + dropdown rendered by the orchestrator.
  // Passing it as a slot keeps the menu's open/close state with the
  // same component that owns the modals it triggers.
  extraActions?: ReactNode;
  // Optional inline stage-select control (small pill-style on the
  // hero). Passed in by the orchestrator because changing stages
  // requires a server action + transition state that doesn't belong
  // here. Hidden on terminal stages (cancelled/refunded) by the caller.
  stageSelectSlot?: ReactNode;
}

export function ProjectHero({
  title,
  eyebrow,
  meta,
  gradientClass,
  playLatestHref,
  extraActions,
  stageSelectSlot,
}: ProjectHeroProps) {
  const { toast } = useToast();

  function copyShareLink() {
    // Guard against SSR — `window` is undefined during server render.
    // The Clipboard API itself is typed as always-defined in the DOM
    // lib but can THROW synchronously in insecure contexts (HTTP, some
    // embedded webviews). The try/catch covers that path; the .catch()
    // covers async rejection (e.g. permissions denied).
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      void navigator.clipboard
        .writeText(url)
        .then(() => {
          toast("Project link copied", "success");
        })
        .catch(() => {
          toast("Couldn't copy link", "error");
        });
    } catch {
      toast("Couldn't copy link", "error");
    }
  }

  return (
    <div
      className={[
        gradientClass,
        // rounded-[var(--radius-lg)] keeps the hero in the same corner
        // language as the surface-card panels below it. text-white is
        // the universal contrast on every gradient.
        "relative overflow-hidden rounded-[var(--radius-lg)] text-white",
      ].join(" ")}
    >
      {/* Subtle dark wash so titles + eyebrow read on the lighter
          gradients (rose, amber, slate). The 5% black is below the
          threshold where it visibly shifts the gradient hue. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-black/5"
      />
      <div className="relative px-5 py-6 sm:px-7 sm:py-8">
        <div className="flex flex-wrap items-end gap-5">
          {/* Album-art-style folder thumbnail. The dark inner panel
              (bg-black/20) keeps the icon legible regardless of the
              underlying gradient brightness. */}
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-black/20 shadow-[0_12px_32px_rgba(0,0,0,0.28)] sm:h-28 sm:w-28">
            <FolderIcon />
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-white/85">
              {eyebrow}
            </p>
            <h1
              className="mt-1 truncate font-display text-3xl leading-tight tracking-tight drop-shadow-[0_2px_14px_rgba(0,0,0,0.18)] sm:text-4xl md:text-5xl"
              style={{ fontWeight: 800 }}
            >
              {title}
            </h1>
            {meta.length > 0 ? (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/90">
                {meta.map((piece, i) => (
                  // Center-dot separator before every entry except the
                  // first. The span wrapper holds the dot + value so
                  // wrap behavior keeps each pair on the same line.
                  <span key={`${String(i)}-${piece}`} className="flex items-center gap-2">
                    {i > 0 ? (
                      <span aria-hidden="true" className="text-white/50">
                        ·
                      </span>
                    ) : null}
                    <span className="tabular">{piece}</span>
                  </span>
                ))}
              </p>
            ) : null}
            {stageSelectSlot ? (
              <div className="mt-3">{stageSelectSlot}</div>
            ) : null}
          </div>

          {/* Right-side action pills. Order: Play latest (white CTA) →
              Share (translucent secondary) → kebab (passed in). Each
              has 44px touch target on mobile via py-2 + the icon size. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {playLatestHref ? (
              <Link
                href={playLatestHref}
                scroll={false}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-[rgb(var(--fg-primary))] shadow-[0_6px_18px_rgba(0,0,0,0.18)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(0,0,0,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <PlayIcon />
                Play latest
              </Link>
            ) : null}
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ShareIcon />
              Share
            </button>
            {extraActions}
          </div>
        </div>
      </div>
    </div>
  );
}

// Inline icons — kept local rather than reusing a global icon set so
// this file stays drop-in and the SVG paths are inspectable in one
// place. Stroke-based outlines match the rest of the dashboard.

function FolderIcon() {
  return (
    <svg
      width={42}
      height={42}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx={18} cy={5} r={3} />
      <circle cx={6} cy={12} r={3} />
      <circle cx={18} cy={19} r={3} />
      <line x1={8.59} y1={13.51} x2={15.42} y2={17.49} />
      <line x1={15.41} y1={6.51} x2={8.59} y2={10.49} />
    </svg>
  );
}
