"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";
import { Input, Label } from "~/components/ui/input";

import { completeStudio } from "../actions";

// Story 03 — Step 1: studio name.
//
// One input ("Display name"). Slug + currency + timezone are all
// invisible: slug + currency are derived server-side in completeStudio;
// timezone is read once from the browser (Intl) and passed to the
// action. The shell handles progress bar, header, ambient blob, and
// the sticky action bar.
//
// Pure helpers (constants + isContinueAllowed + defaultTimezone +
// nextRouteAfterStudio) are exported so the unit test in
// __tests__/page.test.tsx can pin behaviour without RTL — the repo
// runs vitest in `node` env, no jsdom (mirrors progress-bar.test +
// action-bar.test from Story 02).

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const STUDIO_STEP_INDEX: 1 | 2 | 3 | 4 | 5 | 6 = 1;

/** H1 displayed by the shell. Pinned by tests + architecture §6. */
export const STUDIO_STEP_TITLE = "Name your studio.";

/**
 * Subtitle copy. Reassures the producer that nothing is locked in —
 * pinned at the keyword level by the test so a future copy edit that
 * goes formal/legalese forces a deliberate update.
 */
export const STUDIO_STEP_SUBTITLE =
  "A few quick details and you're in. You can change this later from settings.";

/**
 * Continue button gate. Disabled while the trimmed display name is
 * empty (acceptance criteria #2). Server-side zod also enforces
 * trim().min(1) — this is the client-side mirror so the button
 * communicates the requirement immediately.
 */
export function isContinueAllowed(displayName: string): boolean {
  return displayName.trim().length >= 1;
}

/**
 * Read the browser timezone via Intl. Defaults to "UTC" if Intl is
 * unavailable (rare older browsers). Mirrors the fallback used in the
 * pre-Story-03 single-screen onboarding (page.tsx:13-17).
 */
export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Step 1 → Step 2 route. Pinned by tests so a typo is caught early. */
export function nextRouteAfterStudio(): "/onboarding/services" {
  return "/onboarding/services";
}

export default function StudioStepPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const allowContinue = isContinueAllowed(displayName);

  function handleContinue() {
    if (!allowContinue) return;
    setError(null);
    startTransition(async () => {
      try {
        await completeStudio({
          displayName: displayName.trim(),
          timezone: defaultTimezone(),
        });
        // TODO(telemetry): fire producer.onboarding.step_completed
        // with { step: "studio" } once an analytics helper exists.
        router.push(nextRouteAfterStudio());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <OnboardingShell
      currentStep={STUDIO_STEP_INDEX}
      title={STUDIO_STEP_TITLE}
      subtitle={STUDIO_STEP_SUBTITLE}
      onContinue={handleContinue}
      continueLabel="Enter your studio →"
      continueDisabled={!allowContinue}
      pending={pending}
      pendingLabel="Saving…"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleContinue();
        }}
        className="space-y-5"
      >
        <div>
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
            placeholder="Your studio name"
            required
            autoFocus
            maxLength={80}
            // Submit on Enter (default form behavior). The visible
            // Continue button lives inside the shell's sticky ActionBar
            // and is wired via onContinue → handleContinue.
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Shown at the top of your public portfolio.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="text-sm text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}
      </form>

      <p className="mt-8 text-center font-mono text-xs text-[rgb(var(--fg-muted))]">
        You can edit all of this later · nothing&apos;s locked in
      </p>
    </OnboardingShell>
  );
}
