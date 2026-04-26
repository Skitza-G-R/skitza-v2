import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";
import { appRouter } from "~/server/trpc/routers/_app";
import type {
  AvailabilityBlock,
  AvailabilitySettings,
  Blackout,
} from "~/components/dashboard/setup/availability-section";

import { decideOnboardingRedirect } from "../decide-redirect";
import { AvailabilityStepClient } from "./availability-step-client";
import { ONBOARDING_STEP_NAME } from "./constants";

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

// Pure constants + route helpers live in ./constants — both this
// Server Component and ./availability-step-client (a "use client"
// module) import from there. Without that split, the client bundle
// would transitively pull in this file's server-only deps (auth,
// fetchUserRole, appRouter → next/headers via public-profile.ts) and
// Vercel's build would fail with an RSC boundary violation. See
// CLAUDE.md mistake log 2026-04-23.
//
// Re-export every constants.ts entry so existing test imports
// (`from "../page"`) keep working without modification. The client
// component imports directly from ./constants to skip this re-export
// and avoid the server bundle.
export * from "./constants";

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
