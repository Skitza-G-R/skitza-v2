"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { KeyboardHint } from "~/components/ui/keyboard-hint";
import { useToast } from "~/components/ui/toast";
import { useHotkey } from "~/lib/keyboard/use-shortcuts";

// Today Cockpit — ShareLinkCard.
//
// The permanent URL the producer drops into their Instagram bio, DMs,
// and anywhere else fans can find them. One-click copy, one-click
// preview. Lives above the KPI strip on Today so it's the very first
// thing in the producer's eye-line when they log in.
//
// Empty state: if the producer hasn't claimed a slug yet (rare post-
// onboarding, but possible if they skipped the wizard), show a
// "Set your slug" CTA that deep-links into the profile section of
// Settings. A bare "copy" on an empty link would be a footgun.
//
// Styling: matches the existing `.sk-lift` + `.sk-cta-shine` primitives
// and CSS vars; no new design tokens, no motion deps.
export function ShareLinkCard({
  slug,
  publicBaseUrl,
}: {
  slug: string | null;
  publicBaseUrl: string;
}) {
  const { toast } = useToast();
  const t = useTranslations("today.shareLink");
  const tToasts = useTranslations("today.toasts");
  const [justCopied, setJustCopied] = useState(false);

  // If the slug is missing, render a nudge card pointing the producer
  // at Settings → Profile. The copy pivots the tone from "here's your
  // link!" to "you're one step away from having one".
  if (!slug) {
    return (
      <div
        className="mb-6 flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.06)] p-5 sm:flex-row sm:items-center sm:justify-between"
        aria-labelledby="share-link-missing-title"
        data-tour-id="share-link-card"
      >
        <div className="min-w-0">
          <p
            id="share-link-missing-title"
            className="text-base font-semibold text-[rgb(var(--fg-primary))]"
          >
            {t("missingTitle")}
          </p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            {t("missingDescription")}
          </p>
        </div>
        <a
          href="/dashboard/settings?section=profile"
          className="sk-lift inline-flex min-h-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          {t("missingCta")}
        </a>
      </div>
    );
  }

  // `publicBaseUrl` arrives as e.g. "https://skitza.app" or the Vercel
  // preview origin. Strip the trailing slash so the mono display doesn't
  // render "skitza.app//join/alice".
  const origin = publicBaseUrl.replace(/\/$/, "");
  const fullUrl = `${origin}/join/${slug}`;
  // Display form: drop the scheme ("https://") — producers think of
  // this as "skitza.app/join/alice", not a URL. The copy/preview actions
  // still use the fully qualified URL so pasting works everywhere.
  const displayUrl = fullUrl.replace(/^https?:\/\//, "");

  const copy = () => {
    void navigator.clipboard
      .writeText(fullUrl)
      .then(() => {
        setJustCopied(true);
        toast(tToasts("copied"), "success");
        // Brief flash on the label so repeat-clickers see feedback even
        // if the toast is dismissed. Fades back after 1.5s.
        setTimeout(() => {
          setJustCopied(false);
        }, 1500);
      })
      .catch(() => {
        toast(tToasts("couldNotCopy"), "error");
      });
  };

  // Batch D — `C` shortcut on Today copies the share link. The global
  // layer exposes `c` as "create (context-aware)" — page-scoped
  // useHotkey registers *after* the global layer and its
  // preventDefault wins, so Today overrides `c` without disrupting the
  // other surfaces.
  useHotkey("c", copy);

  return (
    // Batch C — ShareLinkCard is the hero anchor of the Today gradient
    // canvas. No heavy border, editorial heading, slug in a generous
    // mono pill that reads as a URL chip on a dashboard, not a
    // greyish input.
    <section
      className="mb-10"
      aria-labelledby="share-link-title"
      data-tour-id="share-link-card"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            {t("eyebrow")}
          </p>
          <h2
            id="share-link-title"
            className="mt-2 font-display text-4xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-5xl"
          >
            {t("headline")}
          </h2>
          <p className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-[rgb(var(--fg-secondary))]">
            {t("description")}
          </p>
          <div
            // The chip reads as one cohesive URL (no internal whitespace
            // gap). Two spans only — muted prefix concatenates
            // "skitza.app/join/" with no separator characters between the
            // segments, and the slug stays in a bolded primary-color sibling.
            // aria-label mirrors the full URL so screen readers don't read
            // the visual chunking as two disjoint phrases.
            className="mt-5 inline-flex max-w-full items-center overflow-x-auto rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 font-mono text-sm text-[rgb(var(--fg-primary))] shadow-[var(--shadow-sm)] sm:text-base"
            title={fullUrl}
            aria-label={displayUrl}
          >
            <span className="text-[rgb(var(--fg-muted))]">skitza.app/join/</span>
            <span className="font-semibold">{slug}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <KeyboardHint shortcut="C">
            <button
              type="button"
              onClick={copy}
              className="sk-lift sk-cta-shine sk-pulse-hover inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-semibold text-[rgb(var(--fg-inverse))] shadow-[var(--shadow-md)] hover:brightness-110"
              aria-label={justCopied ? t("copied") : t("copyButton")}
            >
              {justCopied ? t("copied") : t("copyButton")}
              <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-[rgb(var(--fg-inverse)/0.3)] bg-[rgb(var(--fg-inverse)/0.12)] px-1 font-mono text-[0.62rem]">
                C
              </kbd>
            </button>
          </KeyboardHint>
          <a
            href={fullUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="sk-lift inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-semibold text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-sunken))]"
          >
            {t("preview")}
          </a>
        </div>
      </div>
      {/* displayUrl kept in the DOM for a11y + in case we need the
          plain URL surface back (e.g. when the brand font fails). */}
      <span className="sr-only">{displayUrl}</span>
    </section>
  );
}
