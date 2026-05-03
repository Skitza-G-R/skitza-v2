"use client";

import { useRouter } from "next/navigation";

import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";
import { Button } from "~/components/ui/button";

import {
  PAYMENT_STEP_INDEX,
  PAYMENT_STEP_SUBTITLE,
  PAYMENT_STEP_TITLE,
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "./constants";

// T8 Step 5 — payment provider placeholder. Stripe Connect is "coming
// soon" in v1 (PRD says payments are UI placeholder). The card + its
// button are disabled; Skip and Continue both forward to portfolio.

export function PaymentStepClient() {
  const router = useRouter();

  const advance = () => {
    router.push(nextRouteAfterPayment());
  };
  const skip = () => {
    router.push(routeOnSkipFromPayment());
  };
  const back = () => {
    router.push(routeOnBackFromPayment());
  };

  return (
    <OnboardingShell
      currentStep={PAYMENT_STEP_INDEX}
      title={PAYMENT_STEP_TITLE}
      subtitle={PAYMENT_STEP_SUBTITLE}
      onBack={back}
      onSkip={skip}
      onContinue={advance}
      continueDisabled
    >
      <div
        aria-disabled
        className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 opacity-60"
      >
        <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
          Payment provider
        </p>
        <Button type="button" variant="secondary" disabled>
          Connect payment provider
        </Button>
        <p className="text-xs text-[rgb(var(--fg-muted))]">(coming soon)</p>
      </div>
    </OnboardingShell>
  );
}
