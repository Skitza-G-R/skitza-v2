// UI display states ON TOP OF the stage enum.
//
// `projects.stage` carries the full pg enum (lead, booked,
// in_production, final_review, paid, archived). The UI surfaces THREE
// display states and keeps the underlying enum intact:
//
//   Live      — anything mid-flight (lead, booked, in_production,
//               final_review).
//   Done      — paid.
//   Archived  — archived.
//
// The Project Room header still shows the fine-grained stage label
// (small, muted) under the bold display state, so advanced users can
// still see where they are in the funnel without the producer having
// to cognitively collapse it. The stage dropdown in the 3-dot menu
// also stays — nothing about the data layer changes.

import type { Stage } from "./stages";

export const PROJECT_STATES = ["live", "done", "archived"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export function stageToState(stage: Stage): ProjectState {
  if (stage === "paid") return "done";
  if (stage === "archived") return "archived";
  // Everything else — lead, booked, in_production, final_review — is "live".
  return "live";
}

export const STATE_LABEL: Record<ProjectState, string> = {
  live: "Live",
  done: "Done",
  archived: "Archived",
};

// For display parity with the old STAGE_TONE triples — each state
// picks a color family. `live` leans on the brand primary, `done`
// uses the success/brand-accent tint, `archived` fades to muted.
export const STATE_TONE: Record<
  ProjectState,
  { text: string; bg: string; border: string }
> = {
  live: {
    text: "rgb(var(--brand-primary))",
    bg: "rgb(var(--brand-primary) / 0.12)",
    border: "rgb(var(--brand-primary) / 0.35)",
  },
  done: {
    text: "rgb(var(--brand-accent))",
    bg: "rgb(var(--brand-accent) / 0.12)",
    border: "rgb(var(--brand-accent) / 0.35)",
  },
  archived: {
    text: "rgb(var(--fg-muted))",
    bg: "rgb(var(--bg-sunken))",
    border: "rgb(var(--border-subtle))",
  },
};

// Reverse lookup: given a state, which stages map to it? Used by the
// projects list grouping + the chip count rollup.
export const STATE_TO_STAGES: Record<ProjectState, readonly Stage[]> = {
  live: ["lead", "booked", "in_production", "final_review"],
  done: ["paid"],
  archived: ["archived"],
};

// Narrow type-guard so the query-string parser doesn't need to import
// the PROJECT_STATES array + a cast.
export function isProjectState(v: unknown): v is ProjectState {
  return typeof v === "string"
    && (PROJECT_STATES as readonly string[]).includes(v);
}
