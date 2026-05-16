"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";
import { cn } from "~/lib/cn";

import { saveServiceRoles } from "../actions";
import {
  SERVICES_STEP_INDEX,
  SERVICES_STEP_SUBTITLE,
  SERVICES_STEP_TITLE,
  SERVICE_ROLE_OPTIONS,
  isContinueAllowed,
  nextRouteAfterServices,
  routeOnBackFromServices,
  routeOnSkipFromServices,
} from "./constants";

// T8 Step 2 — multi-select role chips. Producer picks any/all, hits
// Continue → saveServiceRoles → /onboarding/service. Skip writes an
// empty array so re-entry doesn't carry stale roles forward.

export function ServicesStepClient({
  initialRoles,
}: {
  initialRoles: ReadonlyArray<string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([...initialRoles]);

  const allowContinue = isContinueAllowed(selected);

  const toggle = (value: string) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    if (error) setError(null);
  };

  const handleContinue = () => {
    if (!allowContinue) return;
    setError(null);
    startTransition(async () => {
      try {
        await saveServiceRoles({ roles: selected });
        router.push(nextRouteAfterServices());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save — try again.");
      }
    });
  };

  const handleSkip = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveServiceRoles({ roles: [] });
      } catch {
        // Skip swallows save errors — the producer chose not to commit
        // anything; we shouldn't block their forward motion on a write.
      }
      router.push(routeOnSkipFromServices());
    });
  };

  const handleBack = () => {
    router.push(routeOnBackFromServices());
  };

  return (
    <OnboardingShell
      currentStep={SERVICES_STEP_INDEX}
      title={SERVICES_STEP_TITLE}
      subtitle={SERVICES_STEP_SUBTITLE}
      onBack={handleBack}
      onSkip={handleSkip}
      onContinue={handleContinue}
      continueDisabled={!allowContinue || pending}
      pending={pending}
      pendingLabel="Saving…"
    >
      <div role="group" aria-label="Service roles" className="flex flex-wrap gap-2.5">
        {SERVICE_ROLE_OPTIONS.map((opt) => {
          const isOn = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={isOn}
              onClick={() => {
                toggle(opt.value);
              }}
              disabled={pending}
              className={cn(
                "inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border px-4 text-sm transition-colors duration-150 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
                "disabled:pointer-events-none disabled:opacity-40",
                isOn
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--fg-primary))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-sm)] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-sm text-[rgb(var(--fg-danger))]"
        >
          {error}
        </p>
      ) : null}
    </OnboardingShell>
  );
}
