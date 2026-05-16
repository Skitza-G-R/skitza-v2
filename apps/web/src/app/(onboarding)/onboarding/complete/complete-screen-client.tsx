"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ConfettiBurst } from "~/components/onboarding/wizard-shell/confetti-burst";
import {
  CopyIcon,
  InstagramIcon,
  WhatsAppIcon,
  XTwitterIcon,
} from "~/components/onboarding/wizard-shell/share-icons";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";

// Step 6 — "You're live." Done celebration. May 2026 redesign.
//
// Wrapped in WizardChrome with all 5 rail steps marked completed
// (completedCount=5) so the producer sees the full sequence in the
// gold-with-check state — proof of finish. Footer slot is omitted
// because the only forward action ("Open dashboard →") is the H1's
// CTA.
//
// Confetti is intentionally NOT implemented as a CSS particle system
// here — premium confetti needs a JS library (canvas-confetti) and a
// useEffect for the burst. Adding the dep is a separate small brief
// so this commit stays bounded. The subtle gold blur background
// already gives the celebration vibe.
//
// Share strip: 4 buttons. Copy link uses the Clipboard API; the other
// three deep-link to share intents (https://twitter.com/intent/tweet
// etc.) which open the native sharing flow on each platform.

export function CompleteScreenClient({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const joinLink = `skitza.app/join/${slug}`;
  const fullUrl = `https://${joinLink}`;
  const shareText = `Hey — I just opened my hall on Skitza. Book a session here:`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      // clipboard write can throw in non-secure contexts; the link is
      // selectable in the pill below as a fallback.
    }
  };

  const shareButtons: ReadonlyArray<{
    id: string;
    label: string;
    Icon: ({ size }: { size?: number }) => React.ReactElement;
    onClick?: () => void;
    href?: string;
  }> = [
    {
      id: "copy",
      label: "Copy link",
      Icon: CopyIcon,
      onClick: () => void handleCopy(),
    },
    {
      id: "instagram",
      label: "Instagram",
      Icon: InstagramIcon,
      href: "https://www.instagram.com/",
    },
    {
      id: "twitter",
      label: "X",
      Icon: XTwitterIcon,
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${shareText} ${fullUrl}`)}`,
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      Icon: WhatsAppIcon,
      href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${fullUrl}`)}`,
    },
  ];

  return (
    <WizardChrome
      activePosition={5}
      completedCount={5}
      stepIndicator="Done"
    >
      <ConfettiBurst />
      <div className="ob-stagger flex flex-col items-center text-center">
        {/* Live-dot pill: gold-tinted bg + pulsing dot. */}
        <span className="mb-7 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.12)] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--brand-primary-dark))]">
          <span
            aria-hidden
            className="ob-alive-dot inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]"
          />
          Live
        </span>

        <h1
          className="font-display text-[44px] font-extrabold leading-[1.02] tracking-[-0.035em] text-balance sm:text-[56px]"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          You&apos;re live
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>

        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Your hall is open. Share the link below — artists can browse,
          book, and pay in one tap.
        </p>

        {/* Live URL pill */}
        <div className="mt-7 flex w-full max-w-md items-center gap-2 rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3">
          <code className="flex-1 truncate text-left font-mono text-[14px] font-semibold text-[rgb(var(--fg-default))]">
            {joinLink}
          </code>
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy join link"
            className="ob-press inline-flex items-center gap-1.5 rounded-xl bg-[rgb(var(--bg-sidebar))] px-3 py-1.5 text-[12px] font-bold text-white"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Share strip — 4 buttons */}
        <div className="mt-5 grid w-full max-w-md grid-cols-4 gap-2.5">
          {shareButtons.map((b) => {
            const Icon = b.Icon;
            const baseClass =
              "ob-press flex flex-col items-center justify-center gap-1.5 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-3 text-[11px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.08)]";
            const inner = (
              <>
                <Icon size={16} />
                <span>{b.label}</span>
              </>
            );
            if (b.href) {
              return (
                <a
                  key={b.id}
                  href={b.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={baseClass}
                >
                  {inner}
                </a>
              );
            }
            return (
              <button
                key={b.id}
                type="button"
                onClick={b.onClick}
                className={baseClass}
              >
                {inner}
              </button>
            );
          })}
        </div>

        {/* Open dashboard — primary CTA */}
        <Link
          href="/dashboard"
          className="ob-press mt-8 inline-flex w-full max-w-md items-center justify-center gap-2 rounded-xl bg-[rgb(var(--bg-sidebar))] px-5 py-3.5 text-[14px] font-bold text-white shadow-[0_2px_12px_rgba(17,16,9,0.18)] hover:shadow-[0_8px_28px_rgba(17,16,9,0.36)]"
        >
          Open my dashboard
          <span aria-hidden>→</span>
        </Link>

        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary-dark))]">
          Edit anything from settings
        </p>
      </div>
    </WizardChrome>
  );
}
