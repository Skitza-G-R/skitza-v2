// Central definition of the `project_stage` pg enum as used across the
// dashboard. Mirrors packages/db/src/schema.ts so Zod/TypeScript can
// stay in sync.

export const ALL_STAGES = [
  "lead",
  "booked",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;

export type Stage = (typeof ALL_STAGES)[number];

// Kanban-visible subset. Matches the ordering produced by
// project.listByStage on the server.
export const VISIBLE_STAGES = [
  "lead",
  "booked",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;
export type VisibleStage = (typeof VISIBLE_STAGES)[number];

// Dropdown subset — what the producer can set manually. Currently the
// full enum; preserved as a separate export so callers that distinguish
// "manually settable" from "every stage" stay typed.
export const SELECTABLE_STAGES = ALL_STAGES;

export const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  booked: "Booked",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
};

/**
 * Returns true when the project's stage means "no more forward progress is
 * expected." Used by the Project Room header to disable action buttons and
 * by the timeline to suppress the "current" state on mid-funnel steps.
 */
export function isTerminalStage(stage: Stage): boolean {
  return stage === "paid" || stage === "archived";
}
