import posthog from "posthog-js";

// Product analytics events (PostHog). The provider in
// `components/observability/posthog-provider.tsx` owns SDK init; this helper
// only forwards a named event once the SDK is loaded, so callers never have
// to know whether analytics is configured in the current environment.
//
// Keep the union explicit: every event name is a contract with the PostHog
// dashboards, so adding one here is a deliberate product decision.
export type ProductEventName =
  | "simulation_started"
  | "simulation_step"
  | "simulation_completed"
  | "simulation_exited_early"
  // SK-299 — bringing existing work in.
  | "import_row_created"
  | "import_row_needs_info"
  | "post_import_first_paint"
  | "link_shared";

export type ProductEventProperties = Record<string, string | number | boolean | null>;

export function captureProductEvent(
  name: ProductEventName,
  properties: ProductEventProperties = {},
): void {
  if (typeof window === "undefined") return;
  try {
    if (!posthog.__loaded) return;
    posthog.capture(name, properties);
  } catch {
    // Analytics must never break a product surface.
  }
}
