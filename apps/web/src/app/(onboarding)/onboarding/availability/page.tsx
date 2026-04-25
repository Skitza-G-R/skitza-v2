import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";
import type {
  AvailabilityBlock,
  AvailabilitySettings,
  Blackout,
} from "~/components/dashboard/setup/availability-section";

import { decideOnboardingRedirect, type OnboardingStep } from "../decide-redirect";
import { AvailabilityStepClient } from "./availability-step-client";

// Story 05 — Step 3: availability via AvailabilitySection reuse.
//
// The Step 3 page renders the existing <AvailabilitySection> composite
// (components/dashboard/setup/availability-section.tsx) and its 5
// child islands:
//   1. GCalSyncBadge       — UI-only stub ("coming soon" modal)
//   2. DurationPicker      — default session length
//   3. PoliciesEditor      — auto-confirm + cancellation hours
//   4. AvailabilityEditor  — multi-block weekly windows
//   5. BlackoutsEditor     — date-range blocks
//
// Each child handles its own writes via existing producerProcedure
// mutations under booking.* — no new server code. Producer's data
// here is identical in shape to what Setup → Availability would
// later edit, so the producer's first interaction matches every
// subsequent edit.
//
// Why server + client split (mirrors Story 04 /onboarding/service):
// the layout's role gate uses `decideOnboardingRedirect(role, …)` with
// the step-aware arg derived from the `x-pathname` header. That gate
// already lets producer-complete users render Step 3 (the just-completed-
// Step-1 producer is "complete" but mid-flow). The page-level guard
// here re-runs the same role lookup as defense in depth — if the
// layout ever drops its check, the wizard pages still self-protect.
//
// The pure constants + helpers consumed by the test suite are exported
// below, mirroring Story 04's service/page.tsx pattern. The repo runs
// vitest in `node` env (no jsdom) so there's no RTL render — the test
// asserts the constants + the route helpers directly.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const AVAILABILITY_STEP_INDEX: 1 | 2 | 3 | 4 = 3;

/** H1 displayed by the shell. Pinned by tests + architecture §6. */
export const AVAILABILITY_STEP_TITLE = "When are you open?";

/**
 * Subtitle copy. Reassures the producer they don't need to be perfect
 * here — every field has a sensible default, the children auto-save on
 * change, and a producer can return to Setup → Availability any time.
 * Pin a substring (later/skip/change/edit/adjust) so a future copy
 * edit that goes formal/legalese forces a deliberate update.
 */
export const AVAILABILITY_STEP_SUBTITLE =
  "Set your weekly hours, default session length, and cancellation policy. You can adjust any of this later from Setup.";

/**
 * OnboardingStep tag for this page. Passed to decideOnboardingRedirect
 * + (in future stories) the telemetry helpers, so the wire-format
 * "availability" string lives in exactly one place. A typo here (e.g.
 * "available") would silently fall back to the default-arg "studio"
 * branch in the redirect helper, which is the kind of failure that's
 * easy to miss in manual QA — pinning it via a test catches it.
 */
export const ONBOARDING_STEP_NAME: OnboardingStep = "availability";

/**
 * Continue button is always enabled on Step 3.
 *
 * The 5 child editors auto-save on change via their own producer-
 * procedure mutations — there is no Step-3-level form to submit, just
 * the action bar's Continue button which navigates to Step 4.
 * Acceptance criteria #7: "Continue is always enabled — the producer
 * can advance with whatever they've configured."
 *
 * Pinning the invariant as a boolean (rather than letting Continue's
 * disabled state drift implicitly to "false") catches a regression
 * where someone gates Continue on e.g. "blocks.length > 0" without
 * realising the editor children handle their own persistence.
 */
export const AVAILABILITY_CONTINUE_ALWAYS_ENABLED = true;

/**
 * Step 3 → Step 4 route after Continue. Pinned by tests so a typo in
 * the redirect path (e.g. "/onboarding/portolio") is caught at test
 * time rather than at user time.
 */
export function nextRouteAfterAvailability(): "/onboarding/portfolio" {
  return "/onboarding/portfolio";
}

/**
 * Step 3 Skip-ghost-link target. Identical to nextRouteAfterAvailability
 * — Skip and Continue both forward to Step 4. Telemetry distinguishes
 * the two (step_completed vs step_skipped), but routing does not.
 *
 * Kept as its own helper (rather than re-exporting nextRouteAfterAvailability)
 * so a future divergence (e.g. Skip jumps straight to /dashboard) is a
 * single-line change and the test asserts the current invariant (they're
 * aligned today).
 */
export function routeOnSkipFromAvailability(): "/onboarding/portfolio" {
  return "/onboarding/portfolio";
}

/**
 * Step 3 → Step 2 route for the Back button. The wizard is a strict
 * 4-step linear flow; Back from Step 3 lands on Step 2 (service).
 */
export function routeOnBackFromAvailability(): "/onboarding/service" {
  return "/onboarding/service";
}

/**
 * Server-side fetch payload — exactly the prop shape AvailabilitySection
 * needs. Maps booking.* router rows down to the public type contract
 * (drops producerId / id / createdAt that the editors don't read).
 */
type AvailabilityPagePayload = {
  blocks: AvailabilityBlock[];
  blackouts: Blackout[];
  settings: AvailabilitySettings;
};

/**
 * Single round-trip fetch of every datum the 5 children read at first
 * paint. Reuses the same booking.* tRPC procedures the existing
 * /dashboard/booking?tab=sessions page uses, so the data-flow contract
 * stays identical between onboarding and Setup. Concrete return-shape
 * mapping mirrors apps/web/src/app/(app)/dashboard/booking/page.tsx
 * lines 173-186.
 */
async function fetchAvailabilityPayload(
  userId: string,
): Promise<AvailabilityPagePayload> {
  const caller = appRouter.createCaller({ userId });
  const [availabilityBlocks, blackoutRows, settings] = await Promise.all([
    caller.booking.availability.list(),
    caller.booking.blackouts.list(),
    caller.booking.availability.getSettings(),
  ]);
  return {
    blocks: availabilityBlocks.map((b) => ({
      weekday: b.weekday,
      startMin: b.startMin,
      endMin: b.endMin,
    })),
    blackouts: blackoutRows.map((b) => ({
      id: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
      reason: b.reason,
    })),
    settings,
  };
}

export default async function AvailabilityStepPage() {
  // Page-level role guard. The layout already enforces the role wall
  // (artist + unauth + producer-incomplete-on-non-studio), but Story 04
  // established the page-level re-check as defense in depth. If the
  // layout ever drops its role check, the wizard pages still self-protect.
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  // Only producer-{complete,incomplete} reach this point (the role
  // matrix in decide-redirect proves it). The orphan branch redirected
  // to /onboarding/studio above; producer-complete on /onboarding/
  // availability returned null (render). The layout's same-step guard
  // already redirected the rest.
  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") {
    return null;
  }
  if (!userId) return null;

  const payload = await fetchAvailabilityPayload(userId);

  return <AvailabilityStepClient {...payload} />;
}
