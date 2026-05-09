"use client";

import { Plus, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import {
  PORTFOLIO_PLATFORMS,
  emptyExternalLinksState,
  toLinksPayload,
  type ExternalLinksFormState,
  type PortfolioPlatformKey,
} from "~/components/onboarding/external-links-editor";

import { saveExternalLinks } from "./links-actions";
import {
  PORTFOLIO_STEP_INDEX,
  PORTFOLIO_STEP_SUBTITLE,
  PORTFOLIO_STEP_TITLE,
  routeOnBackFromPortfolio,
  routeOnContinueFromPortfolio,
  routeOnSkipFromPortfolio,
} from "./constants";

// Step 4 — A taste of your work. May 2026 redesign (revised
// 2026-05-09 — progressive link disclosure + compact upload stub).
//
// First render shows ONE empty link slot (Spotify) plus a "+ Add another"
// button. Tapping the button reveals the next platform's input, up to
// the 3 platforms the DB schema supports today (Spotify / YouTube /
// Instagram). Producers who only have Spotify get a short, focused
// form; producers with all three can fill them all.
//
// Upload zone is a visual stub per Decision #3 — schema FK blocker
// on track_versions → projectTracks (separate brief).

const PLATFORM_ORDER: PortfolioPlatformKey[] = [
  "spotify",
  "youtube",
  "instagram_reels",
];

export function PortfolioStepClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [links, setLinks] = useState<ExternalLinksFormState>(
    emptyExternalLinksState,
  );
  // Which platforms have been "added" (visible). First render = just
  // Spotify. Tapping "+ Add another" appends the next unrevealed
  // platform from PLATFORM_ORDER.
  const [revealed, setRevealed] = useState<PortfolioPlatformKey[]>([
    "spotify",
  ]);
  const [error, setError] = useState<string | null>(null);

  const updateLink = (key: PortfolioPlatformKey, url: string) => {
    setLinks((prev) => ({ ...prev, [key]: { ...prev[key], url } }));
    if (error) setError(null);
  };

  const removeLink = (key: PortfolioPlatformKey) => {
    setLinks((prev) => ({ ...prev, [key]: { url: "", title: "" } }));
    setRevealed((prev) => prev.filter((k) => k !== key));
  };

  const addNextPlatform = () => {
    const next = PLATFORM_ORDER.find((k) => !revealed.includes(k));
    if (next) setRevealed((prev) => [...prev, next]);
  };

  const canAddMore = revealed.length < PLATFORM_ORDER.length;

  const handleContinue = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveExternalLinks(toLinksPayload(links));
        router.push(routeOnContinueFromPortfolio());
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't save your links — try again or hit Skip.",
        );
      }
    });
  };

  return (
    <WizardChrome
      activePosition={PORTFOLIO_STEP_INDEX}
      stepIndicator="Step 4 of 5"
      footer={
        <WizardFooter
          onBack={() => router.push(routeOnBackFromPortfolio())}
          onSkip={() => router.push(routeOnSkipFromPortfolio())}
          onContinue={handleContinue}
          pending={pending}
        />
      }
    >
      <div className="reveal-up">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 4 of 5 · Optional
        </p>
        <h1
          className="mt-3 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {PORTFOLIO_STEP_TITLE}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {PORTFOLIO_STEP_SUBTITLE}
        </p>

        {/* Compact upload stub */}
        <div className="mt-5 flex items-center gap-3 rounded-xl border-2 border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 py-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
            <UploadCloud size={16} aria-hidden />
          </span>
          <div className="flex-1 text-[12.5px]">
            <div className="font-bold text-[rgb(var(--fg-default))]">
              Track upload — coming soon
            </div>
            <div className="text-[rgb(var(--fg-muted))]">
              For now, add links below. You&apos;ll upload tracks from Setup
              → Portfolio after onboarding.
            </div>
          </div>
        </div>

        {/* Progressive link list */}
        <div className="mt-4 flex flex-col gap-2.5">
          {revealed.map((key) => {
            const platform = PORTFOLIO_PLATFORMS.find((p) => p.key === key);
            if (!platform) return null;
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2"
              >
                <span className="w-20 flex-shrink-0 text-[12px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
                  {platform.label}
                </span>
                <input
                  type="url"
                  value={links[key].url}
                  onChange={(e) => updateLink(key, e.target.value)}
                  placeholder={platform.placeholder}
                  className="flex-1 bg-transparent font-mono text-[13px] text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))]"
                  disabled={pending}
                />
                {revealed.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeLink(key)}
                    aria-label={`Remove ${platform.label}`}
                    className="sk-pop flex h-7 w-7 items-center justify-center rounded-lg text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))] hover:text-[rgb(var(--fg-default))]"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}

          {canAddMore ? (
            <button
              type="button"
              onClick={addNextPlatform}
              className="sk-pop flex items-center justify-center gap-1.5 self-start rounded-full border border-dashed border-[rgb(var(--border-strong))] px-3.5 py-1.5 text-[12px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))]"
            >
              <Plus size={12} aria-hidden />
              Add another link
            </button>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-[13px] text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </WizardChrome>
  );
}
