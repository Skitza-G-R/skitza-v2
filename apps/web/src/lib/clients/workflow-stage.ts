// Workflow stage helper for the Clients & Projects v3 redesign.
//
// Skitza's creative workflow is 5 stages, NOT 6 (Phase 0 decision —
// Gili dropped "Review" + "Delivery" from the prototype's stepper):
//
//   Brief & intake → Production → Mixing → Mastering → Done
//
// Used by:
//   - WORKFLOW_STAGES — the canonical list, source for steppers + dropdowns.
//   - stageLabel / stageColor / stageOrder — pure helpers consumed by
//     TrackRow (album), AlbumHero eyebrow, AlbumStatStrip Status tile,
//     and the WorkflowStepper (Phase 3 Song Space).
//
// Stage colors are Skitza tokens where possible. `production` is the
// only fixed hex — there's no canonical Skitza indigo, but the dark
// Skitza-indigo-ish color from BUILD-NOTES §6.4 is the right visual
// note. All values return raw CSS color strings so they can be used as
// dot backgrounds AND pill borders without re-formatting.

export const WORKFLOW_STAGES = [
  { key: "brief",       label: "Brief & intake",  sub: "Goals, references, deadline" },
  { key: "production",  label: "Production",      sub: "Tracking & arrangement" },
  { key: "mixing",      label: "Mixing",          sub: "Balance, FX, automation" },
  { key: "mastering",   label: "Mastering",       sub: "Final polish & loudness" },
  { key: "done",        label: "Done",            sub: "Delivered" },
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number]["key"];

const LABEL: Record<WorkflowStage, string> = {
  brief:      "Brief & intake",
  production: "Production",
  mixing:     "Mixing",
  mastering:  "Mastering",
  done:       "Done",
};

const COLOR: Record<WorkflowStage, string> = {
  brief:      "rgb(var(--fg-muted))",
  production: "#3F4A60",
  mixing:     "rgb(var(--brand-primary))",
  mastering:  "rgb(var(--fg-success))",
  done:       "rgb(var(--fg-success))",
};

const ORDER: Record<WorkflowStage, number> = {
  brief:      0,
  production: 1,
  mixing:     2,
  mastering:  3,
  done:       4,
};

export function stageLabel(stage: WorkflowStage): string {
  return LABEL[stage];
}

export function stageColor(stage: WorkflowStage): string {
  return COLOR[stage];
}

export function stageOrder(stage: WorkflowStage): number {
  return ORDER[stage];
}
