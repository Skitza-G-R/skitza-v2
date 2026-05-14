// Pure helpers for the 4-step Project Room timeline. The project's
// overall state collapses into a progress bar of four well-known steps
// that match the producer's mental model for moving a project from
// lead through delivery: Trial → In Progress → Final → Paid.
//
// Every step's state is a deterministic function of the inputs — no
// hidden side-effects, no async — so we cover it entirely with unit
// tests (see __tests__/timeline-helpers.test.ts).

import { isTerminalStage, type Stage } from "~/lib/projects/stages";

export type TimelineStepState = "done" | "current" | "pending";

export interface TimelineStep {
  label: string;
  state: TimelineStepState;
}

export interface ProjectTimelineInput {
  stage: Stage;
  chargesCompleted: number;
  // `null` means "plan not yet configured" (e.g. legacy rows or
  // trial-only bookings). When null, the Paid step can never advance
  // to done — we have no denominator to compare `chargesCompleted`
  // against.
  chargesTotal: number | null;
  finalDelivered: boolean;
}

// 4-step timeline: Trial → In Progress → Final → Paid.
// Each step's state is deterministic from the input fields.
//
//   Trial       — "done" if stage !== "lead"
//   In Progress — "done" if finalDelivered; "current" if stage is past "lead" && !finalDelivered; otherwise "pending"
//   Final       — "done" if finalDelivered && chargesTotal > 0 && chargesCompleted === chargesTotal; "current" if finalDelivered && not-fully-paid; otherwise "pending"
//   Paid        — "done" if chargesTotal > 0 && chargesCompleted === chargesTotal; otherwise "pending"
//
// Terminal stages (see isTerminalStage: cancelled, payment_paused,
// paid, archived) override: any step that would have been "current"
// becomes "pending" so the timeline reads as frozen at its last real
// milestone.
export function computeTimeline(p: ProjectTimelineInput): TimelineStep[] {
  const { stage, chargesCompleted, chargesTotal, finalDelivered } = p;
  // >= not === to survive webhook races (two successful PaymentIntents
  // for the same invoice in rapid succession) and overpayment edge cases.
  const fullyPaid =
    chargesTotal !== null && chargesTotal > 0 && chargesCompleted >= chargesTotal;

  // Trial — done once the project has moved past "lead".
  const trial: TimelineStep = {
    label: "Trial",
    state: stage === "lead" ? "pending" : "done",
  };

  // In Progress — done once the producer marks the final delivered.
  // Current once the project has moved past "lead" but delivery hasn't
  // happened.
  const inProgress: TimelineStep = {
    label: "In Progress",
    state: finalDelivered
      ? "done"
      : stage === "lead"
        ? "pending"
        : "current",
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

  const steps: TimelineStep[] = [trial, inProgress, final, paid];

  // Terminal states: no step should read "current" — the project has
  // frozen at whatever state it was in when the producer cancelled / the
  // schedule paused / payment completed / archived. Leave "done" steps
  // as-is so the producer can still see how far it had progressed.
  if (isTerminalStage(stage)) {
    return steps.map((s) => (s.state === "current" ? { ...s, state: "pending" } : s));
  }

  return steps;
}
