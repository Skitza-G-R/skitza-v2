"use client";

import { UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import {
  ExternalLinksEditor,
  emptyExternalLinksState,
  toLinksPayload,
  type ExternalLinksFormState,
  type PortfolioPlatformKey,
} from "~/components/onboarding/external-links-editor";

import { saveExternalLinks } from "./links-actions";
import {
  PORTFOLIO_HELPER_COPY,
  PORTFOLIO_STEP_INDEX,
  PORTFOLIO_STEP_SUBTITLE,
  PORTFOLIO_STEP_TITLE,
  routeOnBackFromPortfolio,
  routeOnContinueFromPortfolio,
  routeOnSkipFromPortfolio,
} from "./constants";

// Step 4 — A taste of your work. May 2026 redesign.
//
// Two regions:
//
//   1. Upload zone — VISUAL STUB only (per Decision #3). The redesign
//      shows a "Drop a track or click to upload" card; we render a
//      dashed-border card explaining producers upload tracks from
//      Setup → Portfolio for now. Real upload waits on the schema FK
//      fix (track_versions.trackId hardwired to projectTracks instead
//      of portfolioTracks). Separate brief.
//
//   2. Add-links list — uses the existing ExternalLinksEditor (Story
//      06 shipped) for now. The redesign's LinksList variant (per-row
//      Save buttons + add-pill chips for unused types) is a follow-up.
//
// Continue saves any typed links via saveExternalLinks then advances
// to /onboarding/payment (Step 5). Skip routes forward without saving.
//
// Pure presentation only — wrapped in WizardChrome with the rail
// pre-highlighting Step 4.

export function PortfolioStepClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [links, setLinks] = useState<ExternalLinksFormState>(
    emptyExternalLinksState,
  );
  const [error, setError] = useState<string | null>(null);

  const updateLink = (key: PortfolioPlatformKey, url: string) => {
    setLinks((prev) => ({ ...prev, [key]: { ...prev[key], url } }));
    if (error) setError(null);
  };

  const updateTitle = (key: PortfolioPlatformKey, title: string) => {
    setLinks((prev) => ({ ...prev, [key]: { ...prev[key], title } }));
    if (error) setError(null);
  };

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

        {/* Upload zone — visual stub. Real upload waits on schema fix. */}
        <div className="mt-6 flex flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-6 py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
            <UploadCloud size={18} aria-hidden />
          </span>
          <p className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
            Track upload — coming soon
          </p>
          <p className="max-w-xs text-[12.5px] text-[rgb(var(--fg-muted))]">
            For now, add your streaming links below. You&apos;ll be able to upload
            tracks from Setup → Portfolio after onboarding.
          </p>
        </div>

        {/* OR divider */}
        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-[rgb(var(--border-subtle))]" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Add links
          </span>
          <span className="h-px flex-1 bg-[rgb(var(--border-subtle))]" />
        </div>

        <p className="mb-3 text-[13px] text-[rgb(var(--fg-muted))]">
          {PORTFOLIO_HELPER_COPY}
        </p>

        <ExternalLinksEditor
          value={links}
          onChange={updateLink}
          onTitleChange={updateTitle}
          disabled={pending}
        />

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
