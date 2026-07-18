"use client";

import { Wallet } from "lucide-react";
import { useRouter } from "next/navigation";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";

import {
  PAYMENT_STEP_INDEX,
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "./constants";

// Step 5 explains the durable payment boundary. There is no provider to
// select: artists pay producers directly outside Skitza.

export function PaymentStepClient() {
  const router = useRouter();

  return (
    <WizardChrome
      activePosition={PAYMENT_STEP_INDEX}
      stepIndicator="Step 5 of 5"
      footer={
        <WizardFooter
          onBack={() => {
            router.push(routeOnBackFromPayment());
          }}
          onSkip={() => {
            router.push(routeOnSkipFromPayment());
          }}
          onContinue={() => {
            router.push(nextRouteAfterPayment());
          }}
          continueLabel="Open the doors"
        />
      }
    >
      <div className="ob-stagger">
        <p className="font-mono text-[11px] font-bold tracking-[0.22em] text-[rgb(var(--brand-primary-dark))] uppercase">
          Step 5 of 5 · Optional
        </p>
        <h1
          className="font-display mt-3 text-[30px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Payments stay between you and the artist.
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Skitza records purchase history, but it does not take, hold, route, or process the
          artist&apos;s money.
        </p>

        <div
          role="note"
          className="mt-6 flex items-start gap-3.5 rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
          >
            <Wallet size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
              External payments only
            </div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
              Use bank transfer, Bit, cash, or another method you arrange directly with the artist.
            </p>
          </div>
        </div>

        <p className="mt-5 rounded-xl bg-[rgb(var(--bg-background))] px-4 py-3 text-center text-[12.5px] text-[rgb(var(--fg-muted))]">
          Finishing setup does not connect a payment provider or change how you get paid.
        </p>
      </div>
    </WizardChrome>
  );
}
