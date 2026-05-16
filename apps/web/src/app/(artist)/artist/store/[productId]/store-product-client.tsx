"use client";

import { useCallback, useState, useTransition } from "react";
import type { PaymentPlan } from "@skitza/db";

import { PlanPicker } from "~/components/checkout/plan-picker";
import { Button } from "~/components/ui/button";
import type { VolumeTier } from "~/lib/pricing";

import { startStoreCheckoutAction } from "./actions";
import { SongCountStepper } from "./song-count-stepper";

// Client Component. Renders the PlanPicker (flat) or SongCountStepper
// (per-song) above the "Continue to checkout" button, then submits to
// a server action which calls artist.store.checkout. For per-song the
// action receives songQty + unitPriceCents so the server can compute
// the locked-in total and create the project/Stripe session for the
// right amount.
export function StoreProductClient({
  product,
}: {
  product: {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
    paymentPlans: PaymentPlan[];
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
  };
}) {
  const first = product.paymentPlans[0];
  const [plan, setPlan] = useState<PaymentPlan | null>(first ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Per-song state — populated by SongCountStepper's onChange. Initial
  // values match the stepper's default (qty 1 at the base tier).
  const isPerSong = product.pricingModel === "per_song";
  const tiers = product.volumeTiers ?? [];
  const baseUnitCents = tiers[0]?.pricePerUnitCents ?? product.priceCents;
  const [songQty, setSongQty] = useState(1);
  const [unitPriceCents, setUnitPriceCents] = useState(baseUnitCents);

  // Memoise the callback so the stepper's useEffect doesn't re-fire on
  // every parent render (stale-closure-safe + cheap).
  const handleStepperChange = useCallback(
    (state: { qty: number; unitPriceCents: number }) => {
      setSongQty(state.qty);
      setUnitPriceCents(state.unitPriceCents);
    },
    [],
  );

  if (!first) {
    // Defensive — every product's default is [{kind:"full"}], so this
    // only fires if a row got persisted with an empty array. Surface a
    // legible error rather than a silent dead button.
    return (
      <p className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 text-sm text-[rgb(var(--fg-secondary))]">
        This product isn&apos;t available for direct checkout yet — reach
        out to the studio directly.
      </p>
    );
  }

  const handleContinue = () => {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const res = await startStoreCheckoutAction({
        productId: product.id,
        paymentPlan: plan,
        ...(isPerSong ? { songQty, unitPriceCents } : {}),
      });
      if (res.ok) {
        if (res.checkoutUrl) {
          window.location.href = res.checkoutUrl;
          return;
        }
        setError("Checkout session couldn't be created. Try again?");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Per-song stepper — only for per_song products. Above the plan
          picker so the artist commits to a qty before they're asked
          to pick a payment plan. */}
      {isPerSong ? (
        <SongCountStepper
          tiers={tiers}
          currency={product.currency}
          onChange={handleStepperChange}
        />
      ) : null}

      {/* Plan picker: only shown when >= 2 plans are offered. A
          single-plan product auto-uses its default silently. The
          totalCents we show reflects the *current* qty selection for
          per-song products so the producer's split / installments
          math reads the locked-in price. */}
      {product.paymentPlans.length > 1 ? (
        <div className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
          <PlanPicker
            plans={product.paymentPlans}
            totalCents={isPerSong ? songQty * unitPriceCents : product.priceCents}
            currency={product.currency}
            onChoose={setPlan}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        disabled={pending || !plan}
        onClick={handleContinue}
      >
        {pending ? "Opening checkout…" : "Continue to checkout"}
      </Button>
    </div>
  );
}
