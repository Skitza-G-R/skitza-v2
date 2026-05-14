"use client";

import { useState } from "react";

import { PUBLIC_BRAND_ORIGIN, buildJoinUrl } from "~/lib/share/public-url";

// Public Link Strip — the dark "hero" card on the producer Overview.
// Mirrors the locked design (notes/producer-screens.jsx :: OverviewTab,
// `LinkBlock` block): dark sidebar-tinted card, amber link icon in a
// subtle ring, eyebrow + subtitle on the left, mono `skitza.app/join/<slug>`
// pill + Copy button on the right.
//
// Behavior: clicking Copy writes the full public URL to the clipboard
// and toggles the button to "Copied" for 1.6s (matches the design's
// dwell time). Falls back gracefully — if `navigator.clipboard` is
// missing (older browsers, insecure context) we still flip the visual
// state so the producer sees acknowledgment, but skip the write.
//
// Mobile: the row collapses to a vertical stack via `flex-wrap`.
//
// `slug` — the producer's chosen handle. We don't render this strip
// when the slug is null (the Day-1 empty branch handles that case).
//
// URL: always the canonical brand origin + /join/<slug>. Pre-2026-05-06
// this took a `publicBaseUrl` prop (env-driven) AND used the deprecated
// `/p/<slug>` path — both bugs fixed at once by routing through
// `~/lib/share/public-url`. The `publicBaseUrl` prop is removed because
// the URL must NOT depend on deployment env (it's brand-canonical).

interface PublicLinkStripProps {
  slug: string;
}

export function PublicLinkStrip({ slug }: PublicLinkStripProps) {
  const [copied, setCopied] = useState(false);

  // Canonical brand origin + /join/<slug>. Always skitza.app/join/<slug>
  // — never the preview host, never the deprecated /p/ path.
  const fullUrl = buildJoinUrl(slug);
  // Display form: drop the scheme so the pill reads `skitza.app/join/`.
  const displayBase = PUBLIC_BRAND_ORIGIN.replace(/^https?:\/\//, "");

  const onCopy = () => {
    // `navigator.clipboard` is gated on a secure context (HTTPS or
    // localhost). When it's missing we still flip the visual state so
    // the producer sees feedback — the click was just a no-op.
    void navigator.clipboard.writeText(fullUrl).catch(() => {
      // swallow — older browsers, denied permission, or insecure contexts.
    });
    setCopied(true);
    // 1.6s window matches the design's dwell time.
    setTimeout(() => {
      setCopied(false);
    }, 1600);
  };

  return (
    <section
      aria-labelledby="public-link-heading"
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-sidebar))] bg-[rgb(var(--bg-sidebar))] p-4 sm:p-[18px]"
    >
      {/* Diagonal shimmer overlay — defined in globals.css. Honours
          prefers-reduced-motion via the keyframe gate. */}
      <span aria-hidden className="animate-shine pointer-events-none" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {/* Amber link icon in a subtle ring */}
          <div
            aria-hidden
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5"
          >
            <LinkIcon />
          </div>
          <div className="min-w-0">
            <h2
              id="public-link-heading"
              className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45"
            >
              Your public link
            </h2>
            <p className="mt-0.5 text-[13px] leading-snug text-white/55">
              Artists listen, book, and pay automatically.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-white/10 bg-white/5 p-1.5">
          <span className="px-3 font-mono text-[13.5px] font-medium">
            <span className="text-white/30">{displayBase}/join/</span>
            <span className="text-white">{slug}</span>
          </span>
          <button
            type="button"
            onClick={onCopy}
            className={[
              "sk-press inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-4 py-2 text-[12.5px] font-bold",
              copied
                ? "bg-[rgb(var(--fg-success))] text-white"
                : "bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]",
            ].join(" ")}
            aria-live="polite"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </section>
  );
}

// — Inline icons (no lucide-react dep) —

function LinkIcon() {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="rgb(var(--brand-primary))"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.5 9.75a3 3 0 0 0 4.243 0l2.121-2.121a3 3 0 0 0-4.243-4.243l-1.06 1.06" />
      <path d="M10.5 8.25a3 3 0 0 0-4.243 0L4.136 10.37a3 3 0 0 0 4.243 4.243l1.06-1.06" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}
