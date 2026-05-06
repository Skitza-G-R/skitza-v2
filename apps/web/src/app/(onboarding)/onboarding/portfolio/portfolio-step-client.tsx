"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";
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

// Story 08 (α-trimmed) — Step 4 client wrapper.
//
// Hosts the shell + <ExternalLinksEditor> (Story 06). Owns the form
// state so Continue can read it before calling saveExternalLinks.
//
// Track upload (originally Story 07) is deferred — the schema FK from
// track_versions to projectTracks (NOT portfolioTracks) means the
// existing R2 multipart pipeline can't be reused for portfolio rows
// without architectural work. Producers add tracks via Setup → Portfolio
// for now; the helper copy in PORTFOLIO_STEP_SUBTITLE makes that explicit.
//
// Continue / Skip distinction (per the architecture decision):
//   • Continue: serialise current state → saveExternalLinks → /dashboard
//   • Skip:     /dashboard directly, no save
//   Both end up on the dashboard; the difference is whether the
//   producer's typed links persist. Telemetry-wise, Continue fires
//   step_completed and Skip fires step_skipped.
//
// Continue is disabled while the saveExternalLinks transition is
// pending (acceptance criteria). Skip is always available so the
// producer can always escape — even if a save is in flight, Skip
// sidesteps it (the save will continue in the background but the user
// won't be blocked waiting).

export function PortfolioStepClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [links, setLinks] = useState<ExternalLinksFormState>(emptyExternalLinksState);
  const [error, setError] = useState<string | null>(null);

  const updateLink = (key: PortfolioPlatformKey, url: string) => {
    setLinks((prev) => ({ ...prev, [key]: { ...prev[key], url } }));
    if (error) setError(null);
  };

  const updateTitle = (key: PortfolioPlatformKey, title: string) => {
    setLinks((prev) => ({ ...prev, [key]: { ...prev[key], title } }));
    if (error) setError(null);
  };

  // Continue: save any typed links, THEN navigate on success only. The
  // earlier shape used try/finally which navigated to /dashboard even
  // when saveExternalLinks threw — that silently lost the producer's
  // typed links and gave them a "wait, where did my Spotify URL go?"
  // surprise on Setup. Now: success → push, error → surface inline so
  // they can fix the input (e.g. a malformed URL the server rejected)
  // and retry, or hit Skip if they want to bail without saving.
  //
  // We always call saveExternalLinks (even when every URL is empty) —
  // the action short-circuits on empty input (parsed.links.length === 0),
  // so an empty submit is a cheap no-op and keeps the timing consistent.
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
            : "Couldn't save your links — try again or hit Skip for now.",
        );
      }
    });
  };

  // Skip: route immediately, no save. Any typed-but-not-saved links
  // are discarded by design — Skip means "not now". A producer can
  // always come back to Setup → Portfolio to add them later.
  const handleSkip = () => {
    router.push(routeOnSkipFromPortfolio());
  };

  const handleBack = () => {
    router.push(routeOnBackFromPortfolio());
  };

  return (
    <OnboardingShell
      currentStep={PORTFOLIO_STEP_INDEX}
      title={PORTFOLIO_STEP_TITLE}
      subtitle={PORTFOLIO_STEP_SUBTITLE}
      onBack={handleBack}
      onSkip={handleSkip}
      onContinue={handleContinue}
      continueDisabled={pending}
      pending={pending}
      pendingLabel="Saving…"
    >
      <div className="flex flex-col gap-6">
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
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
            className="rounded-[var(--radius-sm)] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-sm text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </OnboardingShell>
  );
}
