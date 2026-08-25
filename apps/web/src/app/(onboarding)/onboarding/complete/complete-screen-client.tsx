"use client";

import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  FolderInput,
  Landmark,
  Link2,
  Share2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ConfettiBurst } from "~/components/onboarding/wizard-shell/confetti-burst";
import { PushMomentBanner } from "~/components/push/push-moment-banner";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { buildJoinUrl } from "~/lib/share/public-url";

export const COMPLETE_DASHBOARD_HREF = "/dashboard?storeTip=1" as const;

type FollowUpRoute = "/onboarding/portfolio" | "/onboarding/payment";

export function completionFollowUpHref(route: FollowUpRoute, previewMode: boolean): string {
  return previewMode ? `${route}?__preview=1` : route;
}

export function artistPreviewHref(slug: string, previewMode: boolean): string {
  if (previewMode) return "/onboarding/review?__preview=1";
  return buildJoinUrl(slug);
}

export function CompleteScreenClient({
  slug,
  previewMode = false,
}: {
  slug: string;
  previewMode?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullUrl = buildJoinUrl(slug);
  const displayUrl = fullUrl.replace(/^https?:\/\//, "");
  const previewHref = artistPreviewHref(slug, previewMode);
  const portfolioHref = completionFollowUpHref("/onboarding/portfolio", previewMode);
  const paymentHref = completionFollowUpHref("/onboarding/payment", previewMode);

  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const resetCopyStatusLater = () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => {
      setCopyStatus("idle");
    }, 2200);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    resetCopyStatusLater();
  };

  const handleNativeShare = async () => {
    const url = previewMode ? `${window.location.origin}${previewHref}` : fullUrl;

    try {
      await navigator.share({
        title: "My public page on Skitza",
        text: "Listen to my work and see what we can make together.",
        url,
      });
    } catch {
      // Closing the native share sheet is a normal outcome.
    }
  };

  return (
    <WizardChrome
      activePosition={5}
      completedCount={5}
      stepIndicator="Setup complete"
      previewMode={previewMode}
    >
      <ConfettiBurst />

      <div className="ob-stagger flex flex-col items-center text-center">
        <span className="inline-flex min-h-8 items-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.12)] px-3 font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
          <span
            aria-hidden
            className="ob-alive-dot inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]"
          />
          Published
        </span>

        <h1
          className="font-display mt-5 max-w-xl text-[38px] leading-[1.04] font-extrabold tracking-[-0.035em] text-balance sm:text-[52px]"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Your public page is ready to share
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>

        <p className="mt-4 max-w-md text-[15px] leading-6 text-[rgb(var(--fg-muted))]">
          Send your link when you&apos;re ready. You can keep editing your page from the dashboard.
        </p>

        <section
          aria-labelledby="public-page-link-heading"
          className="relative mt-7 w-full overflow-hidden rounded-[var(--radius-xl)] bg-[rgb(var(--bg-sidebar))] px-4 py-5 text-left text-white shadow-[0_18px_48px_rgb(var(--bg-sidebar)/0.22)] sm:px-6 sm:py-6"
        >
          <div
            aria-hidden
            className="absolute -top-24 -right-16 h-52 w-52 rounded-full bg-[rgb(var(--brand-primary)/0.24)] blur-3xl"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgb(var(--brand-primary)/0.8)] to-transparent"
          />

          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] font-bold tracking-[0.17em] text-white/55 uppercase">
                  Your public page
                </p>
                <h2 id="public-page-link-heading" className="mt-1 text-[15px] font-bold text-white">
                  Ready for artists
                </h2>
              </div>
              <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]">
                <Check aria-hidden size={16} strokeWidth={3} />
              </span>
            </div>

            <div className="mt-5 flex min-w-0 items-center gap-2 rounded-[var(--radius-lg)] border border-white/12 bg-white/[0.07] p-1.5 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-white/90 sm:text-[13px]">
                {displayUrl}
              </code>
              <button
                type="button"
                onClick={() => void handleCopy()}
                aria-label="Copy public page link"
                className="ob-press inline-flex min-h-11 flex-shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-white px-3 text-[12px] font-bold text-[rgb(var(--bg-sidebar))] shadow-sm transition-colors hover:bg-[rgb(var(--brand-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-sidebar))] focus-visible:outline-none"
              >
                {copyStatus === "copied" ? (
                  <Check aria-hidden size={14} />
                ) : (
                  <Copy aria-hidden size={14} />
                )}
                {copyStatus === "copied" ? "Copied" : "Copy link"}
              </button>
            </div>

            <p aria-live="polite" className="mt-2 min-h-4 px-1 text-[11px] text-white/55">
              {copyStatus === "copied"
                ? "Link copied."
                : copyStatus === "failed"
                  ? "Copy did not work. Select the link above to copy it."
                  : "This is the link you can send to artists."}
            </p>
          </div>
        </section>

        <Link
          href={COMPLETE_DASHBOARD_HREF}
          className="ob-press mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-extrabold text-[rgb(var(--bg-sidebar))] shadow-[0_12px_30px_rgb(var(--brand-primary)/0.24)] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] hover:text-white focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Open dashboard
          <ArrowRight aria-hidden size={17} />
        </Link>

        <PushMomentBanner message="Get an alert when clients book, pay, or comment." />

        <Link
          href={previewHref}
          target={previewMode ? undefined : "_blank"}
          rel={previewMode ? undefined : "noopener noreferrer"}
          className="ob-press mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[13px] font-bold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--brand-primary)/0.6)] hover:bg-[rgb(var(--brand-primary)/0.06)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        >
          Preview as artist
          <ExternalLink aria-hidden size={14} />
        </Link>

        {canShare ? (
          <button
            type="button"
            onClick={() => void handleNativeShare()}
            className="ob-press mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[13px] font-bold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--brand-primary)/0.6)] hover:bg-[rgb(var(--brand-primary)/0.06)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none sm:hidden"
          >
            <Share2 aria-hidden size={15} />
            Share from your phone
          </button>
        ) : null}

        <section
          aria-labelledby="optional-next-steps-heading"
          className="mt-9 w-full border-t border-[rgb(var(--border-subtle))] pt-7 text-left"
        >
          <div>
            <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
              Optional next steps
            </p>
            <h2
              id="optional-next-steps-heading"
              className="mt-1.5 text-[19px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]"
            >
              Add more whenever you want
            </h2>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link
              href="/dashboard/clients-projects/bring-active-work"
              className="ob-card-press group rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.055)] p-4 hover:border-[rgb(var(--brand-primary)/0.65)] hover:shadow-[0_12px_28px_rgb(var(--bg-sidebar)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none sm:col-span-2 sm:flex sm:items-center sm:gap-4"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]">
                <FolderInput aria-hidden size={18} />
              </span>
              <span className="mt-4 block min-w-0 flex-1 sm:mt-0">
                <span className="block text-[15px] font-extrabold text-[rgb(var(--fg-default))]">
                  Bring in your active work
                </span>
                <span className="mt-1.5 block text-[12px] leading-5 text-[rgb(var(--fg-muted))]">
                  Add the clients and projects you already started. Nothing is sent while you set
                  things up. Reminders turn on for unpaid payments only when you finish setup.
                </span>
              </span>
              <span className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3.5 text-[12.5px] font-bold text-[rgb(var(--bg-background))] sm:mt-0 sm:shrink-0">
                Add active work
                <ArrowRight aria-hidden size={14} />
              </span>
            </Link>

            <Link
              href={portfolioHref}
              className="ob-card-press group rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 hover:border-[rgb(var(--brand-primary)/0.55)] hover:shadow-[0_12px_28px_rgb(var(--bg-sidebar)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
                <Link2 aria-hidden size={17} />
              </span>
              <span className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
                  Add portfolio links
                </span>
                <ArrowRight
                  aria-hidden
                  size={15}
                  className="flex-shrink-0 text-[rgb(var(--fg-muted))] transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="mt-1.5 block text-[12px] leading-5 text-[rgb(var(--fg-muted))]">
                Show artists where they can hear more of your work.
              </span>
            </Link>

            <Link
              href={paymentHref}
              className="ob-card-press group rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 hover:border-[rgb(var(--brand-primary)/0.55)] hover:shadow-[0_12px_28px_rgb(var(--bg-sidebar)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
                <Landmark aria-hidden size={17} />
              </span>
              <span className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[14px] font-extrabold text-[rgb(var(--fg-default))]">
                  Add direct payment details
                </span>
                <ArrowRight
                  aria-hidden
                  size={15}
                  className="flex-shrink-0 text-[rgb(var(--fg-muted))] transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="mt-1.5 block text-[12px] leading-5 text-[rgb(var(--fg-muted))]">
                Bank or Bit details stay private until you approve a request. Skitza never handles
                the money.
              </span>
            </Link>
          </div>
        </section>
      </div>
    </WizardChrome>
  );
}
