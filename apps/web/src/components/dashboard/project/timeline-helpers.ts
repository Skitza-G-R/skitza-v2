// Pure helpers for the 5-step Project Room timeline. The project's
// overall state collapses into a progress bar of five well-known steps
// that match the producer's mental model for moving a project from
// lead through delivery: Trial → Contract → In Progress → Final → Paid.
//
// Every step's state is a deterministic function of the inputs — no
// hidden side-effects, no async — so we cover it entirely with unit
// tests (see __tests__/timeline-helpers.test.ts).

import type { Stage } from "~/lib/projects/stages";

export type TimelineStepState = "done" | "current" | "pending";

export interface TimelineStep {
  label: string;
  state: TimelineStepState;
}

export interface ProjectTimelineInput {
  stage: Stage;
  contractSigned: boolean;
  chargesCompleted: number;
  // `null` means "plan not yet configured" (e.g. legacy rows or
  // trial-only bookings). When null, the Paid step can never advance
  // to done — we have no denominator to compare `chargesCompleted`
  // against.
  chargesTotal: number | null;
  finalDelivered: boolean;
}

// Is the project in a terminal / absorbing state? We draw the steps
// as whatever they were at the moment of cancellation / pause, but
// we never show a "current" step — the project isn't actively
// progressing through it anymore.
function isAbsorbing(stage: Stage): boolean {
  return stage === "cancelled" || stage === "payment_paused";
}

// 5-step timeline: Trial → Contract → In Progress → Final → Paid.
// Each step's state is deterministic from the input fields.
//
//   Trial       — "done" if stage !== "lead"
//   Contract    — "done" if contractSigned; "current" if stage === "contract_sent" (and !signed); otherwise "pending"
//   In Progress — "done" if finalDelivered; "current" if contractSigned && !finalDelivered; otherwise "pending"
//   Final       — "done" if finalDelivered && chargesTotal > 0 && chargesCompleted === chargesTotal; "current" if finalDelivered && not-fully-paid; otherwise "pending"
//   Paid        — "done" if chargesTotal > 0 && chargesCompleted === chargesTotal; otherwise "pending"
//
// Absorbing stages (`cancelled`, `payment_paused`) override: any step
// that would have been "current" becomes "pending" so the timeline
// reads as frozen at its last real milestone.
export function computeTimeline(p: ProjectTimelineInput): TimelineStep[] {
  const { stage, contractSigned, chargesCompleted, chargesTotal, finalDelivered } = p;
  const fullyPaid =
    chargesTotal !== null && chargesTotal > 0 && chargesCompleted === chargesTotal;

  // Trial — done once the project has moved past "lead".
  const trial: TimelineStep = {
    label: "Trial",
    state: stage === "lead" ? "pending" : "done",
  };

  // Contract — done once signed; current while the producer is waiting
  // on a signature (stage === "contract_sent" and not yet signed).
  const contract: TimelineStep = {
    label: "Contract",
    state: contractSigned
      ? "done"
      : stage === "contract_sent"
        ? "current"
        : "pending",
  };

  // In Progress — done once the producer marks the final delivered.
  // Current once the contract is signed but delivery hasn't happened.
  const inProgress: TimelineStep = {
    label: "In Progress",
    state: finalDelivered
      ? "done"
      : contractSigned
        ? "current"
        : "pending",
  };

  // Final — done once delivered AND fully paid. Current once delivered
  // but charges still pending.
  const final: TimelineStep = {
    label: "Final",
    state: finalDelivered
      ? fullyPaid
        ? "done"
        : "current"
      : "pending",
  };

  // Paid — done only once we know the plan denominator and every charge
  // has landed. Unknown plan (chargesTotal=null) keeps this pending.
  const paid: TimelineStep = {
    label: "Paid",
    state: fullyPaid ? "done" : "pending",
  };

  const steps: TimelineStep[] = [trial, contract, inProgress, final, paid];

  // Absorbing states: no step should read "current" — the project has
  // frozen at whatever state it was in when the producer cancelled / the
  // schedule paused. Leave "done" steps as-is so the producer can still
  // see how far it had progressed.
  if (isAbsorbing(stage)) {
    return steps.map((s) => (s.state === "current" ? { ...s, state: "pending" } : s));
  }

  return steps;
}
