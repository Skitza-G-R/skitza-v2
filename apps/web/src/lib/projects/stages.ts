// Central definition of the `project_stage` pg enum as used across the
// dashboard. Mirrors packages/db/src/schema.ts so Zod/TypeScript can
// stay in sync. `SELECTABLE_STAGES` is the subset the producer can
// pick from the dropdown — `cancelled` is set via the Cancel button
// (Stripe schedule cancellation runs first) and `payment_paused` is
// webhook-driven on Smart Retries exhaustion.

export const ALL_STAGES = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
  "payment_paused",
  "cancelled",
] as const;

export type Stage = (typeof ALL_STAGES)[number];

// Kanban-visible subset — excludes the two terminal/paused stages.
// Used by projects-list chip bar. Matches the ordering produced by
// project.listByStage on the server.
export const VISIBLE_STAGES = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;
export type VisibleStage = (typeof VISIBLE_STAGES)[number];

// Dropdown subset — what the producer can set manually. Excludes the
// two side-effect stages (`cancelled` goes through the Cancel button
// so Stripe schedule cancellation runs first; `payment_paused` is
// webhook-driven on Smart Retries exhaustion).
export const SELECTABLE_STAGES = ALL_STAGES.filter(
  (s) => s !== "cancelled" && s !== "payment_paused",
) as ReadonlyArray<Exclude<Stage, "cancelled" | "payment_paused">>;

export const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  booked: "Booked",
  contract_sent: "Contract sent",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
  payment_paused: "Payment paused",
  cancelled: "Cancelled",
};
