"use client";

import { Check, Globe2, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";

import { completeStudio } from "../actions";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

export const STUDIO_STEP_INDEX: 1 | 2 | 3 | 4 | 5 = 2;
export const STUDIO_STEP_TITLE = "Name your public page.";
export const STUDIO_STEP_SUBTITLE =
  "Use the studio or producer name artists already know. You can edit it later.";

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

export function nextRouteAfterStudio(): "/onboarding/service" {
  return "/onboarding/service";
}

function previewSlug(displayName: string, existingSlug: string): string {
  if (existingSlug.trim()) return existingSlug;
  const body = displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return body || "your-name";
}

export function StudioStepClient({
  initialDisplayName,
  initialSlug,
  initialCurrency,
  initialTimezone,
  previewMode = false,
  canExit = false,
  createStudioIntent = false,
}: {
  initialDisplayName: string;
  initialSlug: string;
  initialCurrency: Currency;
  initialTimezone: string;
  previewMode?: boolean;
  canExit?: boolean;
  createStudioIntent?: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [timezone, setTimezone] = useState(() =>
    initialTimezone && initialTimezone !== "UTC" ? initialTimezone : defaultTimezone(),
  );

  const allowContinue = isContinueAllowed(displayName);
  const publicSlug = previewSlug(displayName, initialSlug);
  const previewSuffix = previewMode ? "?__preview=1" : "";

  function handleContinue() {
    if (!allowContinue) return;
    setError(null);

    if (previewMode) {
      router.push(`${nextRouteAfterStudio()}${previewSuffix}`);
      return;
    }
    if (!online) {
      setError("Reconnect to save your public page.");
      return;
    }

    startTransition(async () => {
      try {
        await completeStudio({
          displayName: displayName.trim(),
          timezone,
          currency,
          ...(createStudioIntent ? { intent: "create-studio" as const } : {}),
        });
        router.push(nextRouteAfterStudio());
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not save your public page. Try again.",
        );
      }
    });
  }

  return (
    <WizardChrome
      activePosition={STUDIO_STEP_INDEX}
      completedCount={1}
      stepIndicator="Public page"
      canExit={canExit}
      previewMode={previewMode}
      footer={
        <WizardFooter
          onBack={() => {
            router.push(`/onboarding/welcome${previewSuffix}`);
          }}
          onContinue={handleContinue}
          continueDisabled={!allowContinue}
          pending={pending}
        />
      }
    >
      <div className="ob-stagger">
        <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-[rgb(var(--brand-primary-dark))] uppercase">
          Public page · Required
        </p>
        <h1
          className="font-display mt-3 max-w-[14ch] text-[36px] leading-[0.98] font-extrabold tracking-[-0.04em] text-balance sm:text-[46px]"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {STUDIO_STEP_TITLE}
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {STUDIO_STEP_SUBTITLE}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleContinue();
          }}
          className="mt-7"
        >
          <label
            htmlFor="displayName"
            className="mb-2 block text-[12px] font-bold text-[rgb(var(--fg-default))]"
          >
            Studio or producer name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
            placeholder="e.g. Gili Asraf"
            required
            autoFocus
            maxLength={80}
            autoComplete="organization"
            className="min-h-12 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[16px] font-medium text-[rgb(var(--fg-default))] transition-shadow outline-none placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_4px_rgb(var(--brand-primary)/0.12)]"
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[rgb(var(--fg-default))]">
                <MapPin size={13} aria-hidden />
                Timezone
              </span>
              <input
                value={timezone}
                onChange={(event) => {
                  setTimezone(event.target.value);
                }}
                aria-label="Timezone"
                className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.18)]"
              />
            </label>
            <label className="block">
              <span className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[rgb(var(--fg-default))]">
                <Globe2 size={13} aria-hidden />
                Currency
              </span>
              <select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value as Currency);
                }}
                aria-label="Currency"
                className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[14px] text-[rgb(var(--fg-default))] outline-none focus:border-[rgb(var(--brand-primary))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.18)]"
              >
                <option value="USD">USD · US dollar</option>
                <option value="EUR">EUR · Euro</option>
                <option value="GBP">GBP · British pound</option>
                <option value="ILS">ILS · Israeli shekel</option>
              </select>
            </label>
          </div>

          <p className="mt-2 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            We detected these for scheduling and prices. Confirm or change them now.
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-[13px] text-[rgb(var(--fg-danger))]"
            >
              {error}
            </div>
          ) : null}
        </form>

        <div className="relative mt-6 overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[0_18px_50px_rgb(var(--bg-sidebar)/0.07)]">
          <div
            aria-hidden
            className="absolute top-[-4rem] right-[-3rem] h-40 w-40 rounded-full bg-[rgb(var(--brand-primary)/0.16)] blur-3xl"
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-bold tracking-[0.15em] text-[rgb(var(--brand-primary-dark))] uppercase">
                Your public link
              </p>
              <p className="mt-2 truncate font-mono text-[12px] font-semibold text-[rgb(var(--fg-secondary))] sm:text-[13px]">
                skitza.app/join/{publicSlug}
              </p>
              <h2 className="font-display mt-4 truncate text-[24px] font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
                {displayName.trim() || "Your name"}
              </h2>
            </div>
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]">
              <Check size={15} strokeWidth={3} aria-hidden />
            </span>
          </div>
          <p className="relative mt-3 text-[12px] text-[rgb(var(--fg-muted))]">
            Your product will appear here after the final review.
          </p>
        </div>
      </div>
    </WizardChrome>
  );
}
