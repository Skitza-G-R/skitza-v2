// Pure banner-selection helper for the public /share/<token> page.
//
// Given a project's stage, decide which (if any) state banner to render
// above the project room. Three current variants:
//   - "paused":    payment_paused stage. Surfaces the Stripe Portal
//                  link so the client can update their card.
//   - "cancelled": cancelled stage. Static banner explaining the
//                  engagement ended; past mixes remain accessible but
//                  comments shouldn't be encouraged.
//   - null:        no banner — render the project room as normal.
//
// Extracted from page.tsx so the selection logic can be unit-tested
// without React Testing Library (this app's test config is Node-only;
// see vitest.config.ts).

export type BannerKind = "paused" | "cancelled" | null;

export type BannerStageInput =
  | "lead"
  | "booked"
  | "contract_sent"
  | "in_production"
  | "final_review"
  | "paid"
  | "archived"
  | "payment_paused"
  | "cancelled";

/**
 * Maps a project stage to the banner the share page should render.
 * Returns null when the project room renders normally.
 */
export function selectBanner(stage: BannerStageInput): BannerKind {
  if (stage === "payment_paused") return "paused";
  if (stage === "cancelled") return "cancelled";
  return null;
}
