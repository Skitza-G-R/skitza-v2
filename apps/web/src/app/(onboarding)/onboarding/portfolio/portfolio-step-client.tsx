"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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

  const updateLink = (key: PortfolioPlatformKey, url: string) => {
    setLinks((prev) => ({ ...prev, [key]: url }));
  };

  // Continue: save any typed links, then route to /dashboard. We always
  // call saveExternalLinks (even when every URL is empty) — the action
  // itself short-circuits on empty input via parsed.links.length === 0,
  // so an empty submit is a cheap no-op. Keeping the call site
  // unconditional means the navigation timing is consistent regardless
  // of input state.
  const handleContinue = () => {
    startTransition(async () => {
      try {
        await saveExternalLinks(toLinksPayload(links));
      } finally {
        router.push(routeOnContinueFromPortfolio());
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
        <ExternalLinksEditor value={links} onChange={updateLink} disabled={pending} />
      </div>
    </OnboardingShell>
  );
}
