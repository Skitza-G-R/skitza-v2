"use client";

import { useState, useTransition } from "react";
import type { PaymentPlan } from "@skitza/db";

import { PlanPicker } from "~/components/checkout/plan-picker";
import { Button } from "~/components/ui/button";
import { startStoreCheckoutAction } from "./actions";

// Client Component. Renders the PlanPicker (auto-selects the first
// plan when only one is offered — no picker shown in that case, just
// a "Continue to checkout" button that uses the default). Submits to
// a server action which calls artist.store.checkout and returns the
// Stripe URL; we then client-side-redirect so Stripe takes over.
export function StoreProductClient({
  product,
}: {
  product: {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
    paymentPlans: PaymentPlan[];
  };
}) {
  const first = product.paymentPlans[0];
  const [plan, setPlan] = useState<PaymentPlan | null>(first ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      });
      if (res.ok) {
        if (res.checkoutUrl) {
          window.location.href = res.checkoutUrl;
          return;
        }
        // The helper can return null if Stripe itself produced no URL
        // (very rare — usually means the session wasn't created). Show
        // a clear error rather than a silent failure.
        setError("Checkout session couldn't be created. Try again?");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Plan picker: only shown when >= 2 plans are offered. A
          single-plan product auto-uses its default silently. */}
      {product.paymentPlans.length > 1 ? (
        <div className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
          <PlanPicker
            plans={product.paymentPlans}
            totalCents={product.priceCents}
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
