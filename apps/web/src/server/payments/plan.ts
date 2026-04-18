import type { PaymentPlan } from "@skitza/db";

// ─── calculateCharges ─────────────────────────────────────────────
// Given a payment plan + total cents, return the per-charge breakdown
// array. Any cent remainder goes on the FIRST charge so the sum is
// always exactly the total (no rounding loss, no client dispute).
//
// Implemented as a single switch on `plan.kind` so TypeScript's
// exhaustiveness check covers every variant of the PaymentPlan union
// — if a new variant is added, the `never` assignment in `default`
// becomes a compile error, forcing us to handle it.
export function calculateCharges(plan: PaymentPlan, totalCents: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new Error(`totalCents must be a positive integer, got ${String(totalCents)}`);
  }

  switch (plan.kind) {
    case "full":
      return [totalCents];

    case "split_50_50": {
      const half = Math.floor(totalCents / 2);
      const remainder = totalCents - half * 2;
      return [half + remainder, half];
    }

    case "monthly": {
      if (plan.installments < 2 || plan.installments > 12) {
        throw new Error(`installments must be between 2 and 12, got ${String(plan.installments)}`);
      }
      const base = Math.floor(totalCents / plan.installments);
      const remainder = totalCents - base * plan.installments;
      return Array.from({ length: plan.installments }, (_, i) =>
        i === 0 ? base + remainder : base,
      );
    }

    default: {
      const _exhaustive: never = plan;
      throw new Error(`unhandled payment plan: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ─── advancePlanState ─────────────────────────────────────────────
// Pure state transition used by webhook handlers + cancel mutation.
// Keeps the invariant chargesCompleted ≤ chargesTotal and maps stage
// transitions for: happy path (charge → active → paid), failure path
// (retries_exhausted → payment_paused → resume → active), cancel.
export type PlanEvent =
  | { type: "charge_succeeded" }
  | { type: "retries_exhausted" }
  | { type: "cancelled" };

export type PlanProjectState = {
  chargesCompleted: number;
  chargesTotal: number;
  stage:
    | "lead"
    | "active"
    | "paid"
    | "payment_paused"
    | "cancelled";
};

export function advancePlanState(
  state: PlanProjectState,
  event: PlanEvent,
): PlanProjectState {
  if (event.type === "cancelled") {
    return { ...state, stage: "cancelled" };
  }

  if (event.type === "retries_exhausted") {
    return { ...state, stage: "payment_paused" };
  }

  // charge_succeeded — increment, but guard the invariant
  if (state.chargesCompleted >= state.chargesTotal) {
    return state; // duplicate webhook, already at terminal count
  }

  const nextCompleted = state.chargesCompleted + 1;
  const nextStage =
    nextCompleted >= state.chargesTotal ? "paid" : "active";
  return { ...state, chargesCompleted: nextCompleted, stage: nextStage };
}
