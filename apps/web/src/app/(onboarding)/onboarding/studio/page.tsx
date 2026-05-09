"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import {
  MONOGRAM_GRADIENTS,
  TAGLINE_MAX_LENGTH,
  initialsFromName,
  isMonogramGradient,
  taglineWithinLimit,
  type MonogramGradient,
} from "~/lib/onboarding/identity-helpers";

import { completeStudio } from "../actions";

// Step 1 — Identity / "Your hall".
//
// May 2026 redesign. Three captures (name + monogram color + tagline);
// the slug field shown in the design HTML is intentionally hidden per
// Decision #1 — slug stays server-derived (4-char hex suffix) so the
// producer never has to think about it. Live monogram preview tile +
// 6-swatch picker, then name + tagline inputs.
//
// Schema dependency: monogram_color + tagline are NEW columns
// (migration 0007_producer_identity, untouched until Raz applies it).
// completeStudio still only writes displayName + timezone today; the
// new fields are accepted in the action signature with a TODO so the
// UI captures them but the writes happen once the migration lands.
//
// Pure helpers (constants + isContinueAllowed + defaultTimezone +
// nextRouteAfterStudio) are exported here so the unit test pins
// behaviour without RTL — the repo runs vitest in `node` env.

/** 1-indexed step number (rail position). Pinned by tests. */
export const STUDIO_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 1;

export const STUDIO_STEP_TITLE = "Your hall, in one breath.";

export const STUDIO_STEP_SUBTITLE =
  "A few details. Everything's editable later.";

/**
 * Continue button gate. Trimmed name must have ≥ 2 characters AND
 * the tagline (if filled) must respect the 80-char ceiling. The
 * server action also re-validates with zod — this is the client-side
 * mirror so the button disabled-state communicates the requirement
 * immediately.
 */
export function isContinueAllowed(
  displayName: string,
  tagline: string,
): boolean {
  return (
    displayName.trim().length >= 2 && taglineWithinLimit(tagline)
  );
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

const DEFAULT_MONOGRAM: MonogramGradient = "grad-amber";

export default function StudioStepPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [monogramColor, setMonogramColor] = useState<MonogramGradient>(
    DEFAULT_MONOGRAM,
  );
  const [tagline, setTagline] = useState("");

  const initials = initialsFromName(displayName);
  const allowContinue = isContinueAllowed(displayName, tagline);
  const taglineCount = tagline.length;

  function handleContinue() {
    if (!allowContinue) return;
    setError(null);
    startTransition(async () => {
      try {
        await completeStudio({
          displayName: displayName.trim(),
          timezone: defaultTimezone(),
          // Accepted by the action signature but persistence is gated
          // on migration 0007 landing — see actions.ts comment.
          monogramColor,
          tagline: tagline.trim(),
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

        {/* Live monogram preview + swatch picker */}
        <div className="mt-6 flex items-center gap-4 rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-4">
          <div
            className={`${monogramColor} flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl font-display text-[26px] font-extrabold tracking-[-0.03em] text-[rgb(var(--bg-sidebar))] transition-colors`}
            style={{
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
            }}
            aria-hidden
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Pick a color
            </div>
            <div className="flex flex-wrap gap-1.5">
              {MONOGRAM_GRADIENTS.map((g) => {
                const isSelected = g === monogramColor;
                return (
                  <button
                    key={g}
                    type="button"
                    aria-label={g.replace("grad-", "")}
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (isMonogramGradient(g)) setMonogramColor(g);
                    }}
                    className={`${g} sk-pop h-[26px] w-[26px] rounded-lg`}
                    style={{
                      boxShadow: isSelected
                        ? "0 0 0 2px rgb(var(--bg-background)), 0 0 0 4px rgb(var(--brand-primary))"
                        : "inset 0 0 0 1px rgba(255,255,255,0.2)",
                      transition: "box-shadow 0.15s",
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Name + tagline */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleContinue();
          }}
          className="mt-5 space-y-5"
        >
          <div>
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
              className="w-full rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 text-[15px] font-medium text-[rgb(var(--fg-default))] outline-none transition-shadow placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_4px_rgba(212,150,10,0.12)]"
            />
          </div>

          <div>
            <label
              htmlFor="tagline"
              className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
            >
              <span>Tagline</span>
              <span className="font-mono text-[10px] font-bold text-[rgb(var(--fg-faint))]">
                {taglineCount}/{TAGLINE_MAX_LENGTH}
              </span>
            </label>
            <textarea
              id="tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="One line about what you make. Skip if you'd rather."
              maxLength={TAGLINE_MAX_LENGTH}
              rows={2}
              className="w-full resize-none rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 text-[14px] text-[rgb(var(--fg-default))] outline-none transition-shadow placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_4px_rgba(212,150,10,0.12)]"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="text-[13px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </WizardChrome>
  );
}
