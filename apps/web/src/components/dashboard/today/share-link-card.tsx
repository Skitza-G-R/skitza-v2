"use client";

import { useState } from "react";

import { useToast } from "~/components/ui/toast";

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
  const [justCopied, setJustCopied] = useState(false);

  // If the slug is missing, render a nudge card pointing the producer
  // at Settings → Profile. The copy pivots the tone from "here's your
  // link!" to "you're one step away from having one".
  if (!slug) {
    return (
      <div
        className="mb-6 flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.06)] p-5 sm:flex-row sm:items-center sm:justify-between"
        aria-labelledby="share-link-missing-title"
      >
        <div className="min-w-0">
          <p
            id="share-link-missing-title"
            className="text-base font-semibold text-[rgb(var(--fg-primary))]"
          >
            Set your share link
          </p>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            Pick a memorable slug (e.g. <code className="font-mono">/p/your-name</code>) so fans can find you from Instagram.
          </p>
        </div>
        <a
          href="/dashboard/settings?section=profile"
          className="sk-lift inline-flex min-h-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          Set your slug
        </a>
      </div>
    );
  }

  // `publicBaseUrl` arrives as e.g. "https://skitza.app" or the Vercel
  // preview origin. Strip the trailing slash so the mono display doesn't
  // render "skitza.app//p/alice".
  const origin = publicBaseUrl.replace(/\/$/, "");
  const fullUrl = `${origin}/p/${slug}`;
  // Display form: drop the scheme ("https://") — producers think of
  // this as "skitza.app/p/alice", not a URL. The copy/preview actions
  // still use the fully qualified URL so pasting works everywhere.
  const displayUrl = fullUrl.replace(/^https?:\/\//, "");

  const copy = () => {
    void navigator.clipboard
      .writeText(fullUrl)
      .then(() => {
        setJustCopied(true);
        toast("Copied", "success");
        // Brief flash on the label so repeat-clickers see feedback even
        // if the toast is dismissed. Fades back after 1.5s.
        setTimeout(() => {
          setJustCopied(false);
        }, 1500);
      })
      .catch(() => {
        toast("Couldn't copy — please copy manually", "error");
      });
  };

  return (
    <section
      className="mb-6 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
      aria-labelledby="share-link-title"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2
            id="share-link-title"
            className="text-base font-semibold text-[rgb(var(--fg-primary))]"
          >
            Your share link.
          </h2>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            Put this in your Instagram bio, send it to fans, embed it anywhere.
          </p>
          <div
            className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-3 py-2 font-mono text-sm text-[rgb(var(--fg-primary))] sm:text-base"
            title={fullUrl}
          >
            {displayUrl}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="sk-lift sk-cta-shine inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-5 text-sm font-semibold text-[rgb(var(--fg-inverse))] hover:brightness-110"
            aria-label={justCopied ? "Copied to clipboard" : "Copy link to clipboard"}
          >
            {justCopied ? "Copied!" : "Copy link"}
          </button>
          <a
            href={fullUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="sk-lift inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-semibold text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-sunken))]"
          >
            Preview
          </a>
        </div>
      </div>
    </section>
  );
}
