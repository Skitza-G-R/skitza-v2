"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";

import { completeStudio } from "../actions";

// Step 1 — Identity / "Your hall".
//
// May 2026 redesign — minimal capture: just the studio/producer name.
// The slug stays server-derived + hidden (Decision #1) and the earlier
// rev's monogram + tagline fields were dropped per Gili's 2026-05-09
// pass — they'd require a schema migration that's out-of-scope, and
// the simpler form fits the no-scroll constraint cleanly.
//
// Pure helpers (constants + isContinueAllowed + defaultTimezone +
// nextRouteAfterStudio) are exported so the unit test pins behaviour
// without RTL — the repo runs vitest in `node` env.

/** 1-indexed step number (rail position). Pinned by tests. */
export const STUDIO_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 1;

export const STUDIO_STEP_TITLE = "Your hall, in one breath.";

export const STUDIO_STEP_SUBTITLE =
  "Just your name to start. Everything's editable later.";

/**
 * Continue button gate. Trimmed name must have ≥ 2 characters. Server
 * action also re-validates with zod.
 */
export function isContinueAllowed(displayName: string): boolean {
  return displayName.trim().length >= 2;
}

export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Step 1 → Step 2 route. The legacy `/onboarding/services` chip step
 * is dropped (Decision #4: drop service_roles entirely), so Step 1
 * advances directly to `/onboarding/service` (the template picker).
 */
export function nextRouteAfterStudio(): "/onboarding/service" {
  return "/onboarding/service";
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
        router.push(nextRouteAfterStudio());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <WizardChrome
      activePosition={STUDIO_STEP_INDEX}
      stepIndicator="Step 1 of 5"
      footer={
        <WizardFooter
          onBack={() => router.push("/onboarding/welcome")}
          onContinue={handleContinue}
          continueDisabled={!allowContinue}
          pending={pending}
        />
      }
    >
      <div className="reveal-up">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 1 of 5 · Required
        </p>
        <h1
          className="mt-3 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {STUDIO_STEP_TITLE}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {STUDIO_STEP_SUBTITLE}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleContinue();
          }}
          className="mt-7"
        >
          <label
            htmlFor="displayName"
            className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
          >
            Studio or producer name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Yael Naim Studio"
            required
            autoFocus
            maxLength={80}
            className="w-full rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5 text-[16px] font-medium text-[rgb(var(--fg-default))] outline-none transition-shadow placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_4px_rgba(212,150,10,0.12)]"
          />
          <p className="mt-2 text-[12.5px] text-[rgb(var(--fg-muted))]">
            Shown at the top of your public hall. You can change this anytime.
          </p>

          {error ? (
            <p
              role="alert"
              className="mt-4 text-[13px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </WizardChrome>
  );
}
