"use client";

import { useState } from "react";
import type { PaymentPlan } from "@skitza/db";
import { planKey, planLabel } from "./plan-picker-helpers";

// Radio-group picker shown between contract signing and Stripe
// redirect. Only renders plans the producer enabled on this product.
// Submits the selected plan via the enclosing form.
export function PlanPicker({
  plans,
  totalCents,
  currency,
  onChoose,
}: {
  plans: PaymentPlan[];
  totalCents: number;
  currency: string;
  onChoose: (plan: PaymentPlan) => void;
}) {
  const first = plans[0];
  const [selected, setSelected] = useState<string>(first ? planKey(first) : "");
  if (!first) return null;

  const format = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Choose how you&apos;d like to pay</legend>
      {plans.map((p) => {
        const key = planKey(p);
        return (
          <label
            key={key}
            className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors ${
              selected === key
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
                : "border-[rgb(var(--border-subtle))]"
            }`}
          >
            <input
              type="radio"
              name="payment_plan"
              value={key}
              checked={selected === key}
              onChange={() => {
                setSelected(key);
                onChoose(p);
              }}
            />
            <span>{planLabel(p, totalCents, format)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
