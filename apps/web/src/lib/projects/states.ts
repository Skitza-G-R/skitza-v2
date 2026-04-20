// Batch G — UI display states ON TOP OF the 9-value stage enum.
//
// Context: `projects.stage` carries a 9-value pg enum (lead, booked,
// contract_sent, in_production, final_review, paid, archived,
// payment_paused, cancelled). That enum is correct for data + the
// server-side funnel but overwhelming as the producer's primary
// filter: eight chips on the projects list, nine labels in every
// header, and a constant "what's the difference between final_review
// and in_production" cognitive tax.
//
// Batch G resolution: the UI surfaces THREE display states and keeps
// the underlying enum intact:
//
//   Live      — anything mid-flight (lead, booked, contract_sent,
//               in_production, final_review, payment_paused).
//   Done      — paid.
//   Archived  — archived or cancelled (both terminal + out-of-feed).
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
  if (stage === "archived" || stage === "cancelled") return "archived";
  // Everything else — lead, booked, contract_sent, in_production,
  // final_review, payment_paused — is "live". Payment-paused is a
  // recoverable in-flight state (the producer can update the card
  // and retry), so surfacing it as "live" matches the producer's
  // mental model: it's not done, not archived, something I need to
  // look at.
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
  live: [
    "lead",
    "booked",
    "contract_sent",
    "in_production",
    "final_review",
    "payment_paused",
  ],
  done: ["paid"],
  archived: ["archived", "cancelled"],
};

// Narrow type-guard so the query-string parser doesn't need to import
// the PROJECT_STATES array + a cast.
export function isProjectState(v: unknown): v is ProjectState {
  return typeof v === "string"
    && (PROJECT_STATES as readonly string[]).includes(v);
}
