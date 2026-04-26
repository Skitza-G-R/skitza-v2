"use client";

import { useTranslations } from "next-intl";

import { useToast } from "~/components/ui/toast";

// SidebarShareChip — the always-visible share-link surface in the
// sidebar footer. Story 05 of the today-redesign epic.
//
// Replaces the previous "Public profile →" link in the sidebar
// footer. Lives next to the theme/notification/locale cluster so the
// producer's link is reachable from every authenticated page (not just
// the Today landing). Today's hero ShareLinkCard is removed in
// Story 06; this chip is its replacement.
//
// Four render variants:
//   - expanded-with-slug   chip body + inline copy button
//   - expanded-no-slug     "Set your slug →" dashed-border CTA
//   - collapsed-with-slug  icon-only copy button (title=URL)
//   - collapsed-no-slug    icon-only gear button to settings
//
// No new design tokens. No new deps. CSS vars only — matches every
// other surface in the sidebar.
//
// RTL: every margin/position uses logical properties (mx-*, ms-*) so
// the chip mirrors automatically under the Hebrew locale.

interface SidebarShareChipProps {
  producerSlug: string | null;
  collapsed: boolean;
  publicBaseUrl: string;
}

// ─── Pure helpers (also exported for unit tests) ────────────────────

/**
 * Joins the public origin to /join/<slug>, stripping a trailing slash
 * on the base URL so we never emit "skitza.app//join/alice".
 *
 * Pure function: same input → same output. Tested directly.
 */
export function buildShareUrl(publicBaseUrl: string, slug: string): string {
  const origin = publicBaseUrl.replace(/\/$/, "");
  return `${origin}/join/${slug}`;
}

/**
 * Returns the display form of the URL — "skitza.app/join/<slug>" —
 * which is what producers think of as their link. The chip body shows
 * this; clipboard copy uses the full {@link buildShareUrl} URL so the
 * pasted text is a real URL.
 */
export function buildDisplayUrl(slug: string): string {
  return `skitza.app/join/${slug}`;
}

export type ChipMode =
  | "expanded-with-slug"
  | "expanded-no-slug"
  | "collapsed-with-slug"
  | "collapsed-no-slug";

/**
 * Picks the render variant from the chip props. Treats empty-string
 * slug as no-slug (defensive — a producer with `slug = ""` is not a
 * configured slug and would render `/join/` with no path).
 */
export function chipMode(props: {
  producerSlug: string | null;
  collapsed: boolean;
}): ChipMode {
  const hasSlug = !!props.producerSlug && props.producerSlug.length > 0;
  if (props.collapsed) {
    return hasSlug ? "collapsed-with-slug" : "collapsed-no-slug";
  }
  return hasSlug ? "expanded-with-slug" : "expanded-no-slug";
}

/**
 * Async copy-to-clipboard handler used by the copy button. Pulled
 * out of the component body so the test can drive the success and
 * failure paths without rendering JSX (vitest runs in node env, no
 * jsdom). Pin a hard no-op when the URL is empty so an accidental
 * empty-slug click can't fire a phantom toast.
 */
export async function triggerCopy(args: {
  url: string;
  writeText: (text: string) => Promise<void>;
  toast: (message: string, variant: "success" | "error") => void;
  tCopied: string;
  tCouldNotCopy: string;
}): Promise<void> {
  if (!args.url) return;
  try {
    await args.writeText(args.url);
    args.toast(args.tCopied, "success");
  } catch {
    args.toast(args.tCouldNotCopy, "error");
  }
}

// ─── Component ──────────────────────────────────────────────────────

export function SidebarShareChip({
  producerSlug,
  collapsed,
  publicBaseUrl,
}: SidebarShareChipProps) {
  const { toast } = useToast();
  const tToasts = useTranslations("today.toasts");
  const mode = chipMode({ producerSlug, collapsed });

  const fullUrl =
    producerSlug && producerSlug.length > 0
      ? buildShareUrl(publicBaseUrl, producerSlug)
      : "";

  function copy() {
    void triggerCopy({
      url: fullUrl,
      writeText: (t) => navigator.clipboard.writeText(t),
      toast,
      tCopied: tToasts("copied"),
      tCouldNotCopy: tToasts("couldNotCopy"),
    });
  }

  // Variant 1 — expanded sidebar + slug present.
  if (mode === "expanded-with-slug") {
    return (
      <div className="mx-2 mb-1 flex items-center gap-1 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-1.5">
        <a
          href={fullUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={fullUrl}
          className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--brand-primary))]"
        >
          <span className="text-[rgb(var(--fg-muted))]">skitza.app/join/</span>
          <span className="font-semibold text-[rgb(var(--fg-primary))]">
            {producerSlug}
          </span>
        </a>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy share link"
          title={fullUrl}
          className="shrink-0 rounded p-1 text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          <CopyIcon />
        </button>
      </div>
    );
  }

  // Variant 2 — expanded sidebar + no slug yet.
  if (mode === "expanded-no-slug") {
    return (
      <a
        href="/dashboard/settings?section=profile"
        className="mx-2 mb-1 flex items-center justify-center rounded-md border border-dashed border-[rgb(var(--border-subtle))] px-2 py-1.5 font-mono text-[0.7rem] text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--brand-primary))]"
      >
        Set your slug →
      </a>
    );
  }

  // Variant 3 — collapsed sidebar + slug present.
  if (mode === "collapsed-with-slug") {
    return (
      <button
        type="button"
        onClick={copy}
        aria-label="Copy share link"
        title={fullUrl}
        className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
      >
        <CopyIcon />
      </button>
    );
  }

  // Variant 4 — collapsed sidebar + no slug yet.
  return (
    <a
      href="/dashboard/settings?section=profile"
      aria-label="Set your slug"
      title="Set your slug"
      className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
    >
      <GearIcon />
    </a>
  );
}

// ─── Icons (inline SVG, matches sidebar.tsx convention) ─────────────

// Two-rectangle clipboard glyph at 14x14. Same drawing convention as
// the icons in sidebar.tsx — stroke=currentColor, no fill.
function CopyIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="8" height="9" rx="1.25" />
      <path d="M9.5 4V2.25a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1H4" />
    </svg>
  );
}

// Gear silhouette at 14x14 for the collapsed-no-slug "go to settings"
// icon. Matches SettingsIcon's drawing in sidebar.tsx, scaled down.
function GearIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2" />
      <path d="M13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.3-1.7.6a5 5 0 0 0-1.8-1L9.3 1.5H6.7l-.2 1.7a5 5 0 0 0-1.8 1l-1.7-.6L1.7 5.9 3.1 7a5 5 0 0 0 0 2l-1.4 1.1 1.3 2.3 1.7-.6a5 5 0 0 0 1.8 1l.2 1.7h2.6l.2-1.7a5 5 0 0 0 1.8-1l1.7.6 1.3-2.3L12.9 9a5 5 0 0 0 .1-1Z" />
    </svg>
  );
}
