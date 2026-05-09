"use client";

import { Banknote, Check, CreditCard, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";

import {
  PAYMENT_STEP_INDEX,
  PAYMENT_STEP_SUBTITLE,
  PAYMENT_STEP_TITLE,
  nextRouteAfterPayment,
  routeOnBackFromPayment,
  routeOnSkipFromPayment,
} from "./constants";

// Step 5 — Get paid directly. May 2026 redesign.
//
// Three payout cards (Stripe Connect / PayPal / Bank transfer) using
// the same selected/unselected pattern as Step 2's service templates.
// Stripe Connect is the default selection but ALL THREE are v1
// placeholders per PRD — the producer's choice doesn't persist
// anywhere (no server action wired). Continue / Skip both advance to
// /onboarding/complete.
//
// Reassurance line at the bottom (mono, gold-deep) per redesign:
// "Funds release 24h after session unless disputed."

type PayoutId = "stripe" | "paypal" | "bank";

interface PayoutOption {
  id: PayoutId;
  icon: typeof CreditCard;
  title: string;
  description: string;
  badge?: string;
}

const PAYOUT_OPTIONS: ReadonlyArray<PayoutOption> = [
  {
    id: "stripe",
    icon: CreditCard,
    title: "Stripe Connect",
    description: "Cards, Apple Pay, ACH. Funds in 2 days.",
    badge: "Recommended",
  },
  {
    id: "paypal",
    icon: Wallet,
    title: "PayPal",
    description: "Connect a PayPal Business account.",
  },
  {
    id: "bank",
    icon: Banknote,
    title: "Bank transfer",
    description: "Wire / SEPA / domestic. Manual.",
  },
];

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
        />
      }
    >
      <div className="reveal-up">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 5 of 5 · Optional
        </p>
        <h1
          className="mt-3 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {PAYMENT_STEP_TITLE}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {PAYMENT_STEP_SUBTITLE}
        </p>

        {/* 3 payout cards — same select pattern as Step 2 templates. */}
        <div className="mt-6 flex flex-col gap-2.5">
          {PAYOUT_OPTIONS.map((opt) => {
            const isSelected = opt.id === selectedId;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedId(opt.id)}
                aria-pressed={isSelected}
                className={`sk-pop relative flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                  isSelected
                    ? "border-transparent bg-[rgb(var(--bg-sidebar))] text-white shadow-[0_6px_18px_rgba(17,16,9,0.18)]"
                    : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                    isSelected
                      ? "bg-[rgb(var(--brand-primary)/0.22)] text-[rgb(var(--brand-primary))]"
                      : "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
                  }`}
                  aria-hidden
                >
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold">{opt.title}</span>
                    {opt.badge ? (
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${
                          isSelected
                            ? "bg-[rgb(var(--brand-primary)/0.22)] text-[rgb(var(--brand-primary))]"
                            : "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]"
                        }`}
                      >
                        {opt.badge}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={`mt-1 text-[12.5px] leading-snug ${isSelected ? "text-white/80" : "text-[rgb(var(--fg-muted))]"}`}
                  >
                    {opt.description}
                  </p>
                </div>
                {isSelected ? (
                  <span
                    aria-hidden
                    className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[rgb(var(--bg-sidebar))]"
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Reassurance line per redesign. */}
        <p className="mt-5 text-center font-mono text-[11px] tracking-[0.04em] text-[rgb(var(--brand-primary-dark))]">
          Funds release 24h after session unless disputed.
        </p>

        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--fg-faint))]">
          Coming soon · placeholder for v1
        </p>
      </div>
    </WizardChrome>
  );
}
