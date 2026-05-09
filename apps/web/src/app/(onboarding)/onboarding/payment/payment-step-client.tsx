"use client";

import { Check, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";

import {
  PAYMENT_STEP_INDEX,
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "./constants";

// Step 5 — How should we pay you? May 2026 redesign (revised
// 2026-05-09 to match the simpler 2-option reference).
//
// Two stacked cards:
//   1. Connect Stripe — cards, Apple Pay, bank transfers (2.9% + $0.30)
//   2. I'll handle payments myself — bank transfer, Bit, cash;
//      Skitza tracks invoices but doesn't process money.
//
// Both options are inert in v1 (no server action wired) — Stripe Connect
// is a UI placeholder per PRD; the "handle myself" option doesn't need
// any wiring beyond letting the producer continue. Final CTA reads
// "Open the doors" since this is the last data-capture step.

type PayoutId = "stripe" | "self";

export function PaymentStepClient() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<PayoutId>("stripe");

  return (
    <WizardChrome
      activePosition={PAYMENT_STEP_INDEX}
      stepIndicator="Step 5 of 5"
      footer={
        <WizardFooter
          onBack={() => router.push(routeOnBackFromPayment())}
          onSkip={() => router.push(routeOnSkipFromPayment())}
          onContinue={() => router.push(nextRouteAfterPayment())}
          continueLabel="Open the doors"
        />
      }
    >
      <div className="ob-stagger">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 5 of 5 · Optional
        </p>
        <h1
          className="mt-3 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          How should we pay you?
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Connect Stripe to accept deposits. We&apos;ll route bookings through
          it. Skip if you&apos;re not ready.
        </p>

        {/* Two payout cards */}
        <div className="mt-6 flex flex-col gap-2.5">
          {/* Stripe card */}
          <button
            type="button"
            onClick={() => setSelectedId("stripe")}
            aria-pressed={selectedId === "stripe"}
            className={`ob-card-press relative flex items-center gap-3.5 rounded-2xl border p-4 text-left ${
              selectedId === "stripe"
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)] shadow-[0_4px_14px_rgba(212,150,10,0.12)]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))] hover:shadow-[0_4px_14px_rgba(17,16,9,0.06)]"
            }`}
            data-stripe-card
          >
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#635BFF] font-display text-[18px] font-extrabold text-white"
            >
              S
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
                Connect Stripe
              </div>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                Cards, Apple Pay, bank transfers · 2.9% + $0.30 per transaction
              </p>
            </div>
            {selectedId === "stripe" ? (
              <span
                aria-hidden
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-white"
              >
                <Check size={12} strokeWidth={3} />
              </span>
            ) : (
              <span
                aria-hidden
                className="h-5 w-5 flex-shrink-0 rounded-full border border-[rgb(var(--border-strong))]"
              />
            )}
          </button>

          {/* Handle myself card */}
          <button
            type="button"
            onClick={() => setSelectedId("self")}
            aria-pressed={selectedId === "self"}
            className={`sk-pop relative flex items-center gap-3.5 rounded-2xl border p-4 text-left transition-all ${
              selectedId === "self"
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))]"
            }`}
          >
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
            >
              <Wallet size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
                I&apos;ll handle payments myself
              </div>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                Bank transfer, Bit, cash — Skitza tracks invoices but
                doesn&apos;t process money.
              </p>
            </div>
            {selectedId === "self" ? (
              <span
                aria-hidden
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-white"
              >
                <Check size={12} strokeWidth={3} />
              </span>
            ) : (
              <span
                aria-hidden
                className="h-5 w-5 flex-shrink-0 rounded-full border border-[rgb(var(--border-strong))]"
              />
            )}
          </button>
        </div>

        {/* Reassurance / settings link */}
        <p className="mt-5 rounded-xl bg-[rgb(var(--bg-background))] px-4 py-3 text-center text-[12.5px] text-[rgb(var(--fg-muted))]">
          You can change or skip this anytime from{" "}
          <span className="font-bold text-[rgb(var(--fg-default))]">
            Settings → Payouts
          </span>
          . Your hall will go live either way.
        </p>
      </div>
    </WizardChrome>
  );
}
