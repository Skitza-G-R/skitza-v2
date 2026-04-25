"use client";

import { useState } from "react";

import { useToast } from "~/components/ui/toast";

// DashboardEmptyOnboarding — the day-1 producer empty state.
//
// Shown ONLY when the producer has no projects, no uploads, and no
// inbox items (see isDayOneEmpty in ../../../app/(app)/dashboard/
// page-helpers.ts). Replaces the entire populated layout — there's
// no inbox-with-zero-items, no zeroed-pulse-card, no contextual
// actions placeholder, just one centered card pointing at the
// share-your-link gateway.
//
// The card's job is psychological, not functional: a fresh producer
// who just signed up should see "your first booking is one share
// away," not a wall of zeros. Once any project / upload / inbox item
// exists, the populated layout returns automatically (the predicate
// flips false).
//
// Render variants:
//   - Slug present → URL chip + Copy button + "Customize your /join page"
//   - No slug yet  → "Set your slug" CTA in place of the chip + same Customize CTA
//
// CSS vars only, no hex (CLAUDE.md style rule). Logical properties
// (ms/me, ps/pe) so the layout mirrors under RTL.

interface DashboardEmptyOnboardingProps {
  /** The producer's slug, or null if not yet picked. */
  slug: string | null;
  /** Origin used to build the full share URL (clipboard payload). */
  publicBaseUrl: string;
}

export function DashboardEmptyOnboarding({
  slug,
  publicBaseUrl,
}: DashboardEmptyOnboardingProps) {
  const { toast } = useToast();
  const [justCopied, setJustCopied] = useState(false);

  const origin = publicBaseUrl.replace(/\/$/, "");
  const fullUrl = slug ? `${origin}/join/${slug}` : null;

  const copy = () => {
    if (!fullUrl) return;
    void navigator.clipboard
      .writeText(fullUrl)
      .then(() => {
        setJustCopied(true);
        toast("Copied", "success");
        setTimeout(() => {
          setJustCopied(false);
        }, 1500);
      })
      .catch(() => {
        toast("Couldn't copy", "error");
      });
  };

  return (
    // Centered tile sitting in the gradient. Generous py keeps the
    // surface reading as a "deliberate empty state," not a stranded
    // card. max-w caps width at a comfortable reading measure so the
    // copy doesn't span ultrawide displays.
    <section
      role="status"
      aria-live="polite"
      data-tour-id="dashboard-empty-onboarding"
      className="mx-auto flex w-full max-w-[42rem] flex-col items-center gap-6 px-2 py-16 text-center sm:py-24"
    >
      <div>
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Get your first booking
        </p>
        <h2 className="mt-3 font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-4xl">
          Your first booking is one share away.
        </h2>
        <p className="mt-3 text-[0.95rem] leading-7 text-[rgb(var(--fg-secondary))]">
          Drop your link, see what happens.
        </p>
      </div>

      {/* Share-link chip + copy button — visible when the producer
          has a slug. The chip body links to the public profile so a
          producer can also one-click open their own page to verify
          how it looks before they share it. */}
      {slug && fullUrl ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href={fullUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={fullUrl}
            className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 font-mono text-sm text-[rgb(var(--fg-primary))] shadow-[var(--shadow-sm)] hover:border-[rgb(var(--brand-primary))]"
            aria-label={`skitza.app/join/${slug}`}
          >
            <span className="text-[rgb(var(--fg-muted))]">skitza.app/join/</span>
            <span className="font-semibold">{slug}</span>
          </a>
          <button
            type="button"
            onClick={copy}
            className="sk-lift sk-cta-shine inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-semibold text-[rgb(var(--fg-inverse))] shadow-[var(--shadow-sm)] hover:brightness-110"
          >
            {justCopied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : (
        // No slug yet — collapse the chip + copy pair into a single
        // "Set your slug" CTA that deep-links to Settings → Profile.
        // Same destination the SidebarShareChip uses in its
        // expanded-no-slug variant.
        <a
          href="/dashboard/settings?section=profile"
          className="sk-lift inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-semibold text-[rgb(var(--fg-inverse))] shadow-[var(--shadow-sm)] hover:brightness-110"
        >
          Set your slug
        </a>
      )}

      {/* Secondary CTA — always rendered, even pre-slug: pointing
          producers at the profile editor is the correct next step in
          either case (with-slug producers can polish the page;
          no-slug producers MUST start there). */}
      <a
        href="/dashboard/settings?section=profile"
        className="text-sm font-medium text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-4 hover:decoration-solid"
      >
        Customize your /join page →
      </a>
    </section>
  );
}
