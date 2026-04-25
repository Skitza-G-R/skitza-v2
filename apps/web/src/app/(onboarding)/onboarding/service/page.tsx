import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect, type OnboardingStep } from "../decide-redirect";
import { ServiceStepClient } from "./service-step-client";

// Story 04 — Step 2: first service via NewPackageForm reuse.
//
// The Step 2 page renders the existing <NewPackageForm> from
// (app)/dashboard/booking/package-form.tsx in pure CREATE mode (no
// initialValues, no fromTemplate). The same form a producer would
// use later in Setup → Services lives here too so the data shape they
// enter at onboarding is identical to every subsequent service.
//
// Why server + client split (vs. Story 03's single-file client page):
// the layout's role gate uses `decideOnboardingRedirect(role)` with
// the default arg "studio", which sends every producer-complete user
// to /dashboard. That's correct for /onboarding/studio (re-doing
// Step 1 is a UX dead-end) but WRONG for Steps 2-4 — a producer who
// just finished Step 1 in the same tab is now "complete" and would
// be bounced out of the wizard before they could finish.
//
// To unblock Step 2 for the just-completed-Step-1 producer, the
// page-level layer here re-runs the role lookup with the step-aware
// arg `decideOnboardingRedirect(role, "service")`. For
// producer-complete + currentStep="service" the helper returns null
// (render), so the page proceeds and the Step 2 form is shown.
//
// Other roles still get redirected the same way the layout would
// have redirected them (defense in depth — if the layout ever drops
// its role check, the wizard pages still self-protect). The auth() +
// fetchUserRole calls are cheap (one indexed Drizzle query worst
// case) and run once per request.
//
// The pure constants + helpers consumed by the test suite are
// exported below, mirroring Story 03's studio/page.tsx pattern. The
// repo runs vitest in `node` env (no jsdom) so there's no RTL render
// — the test asserts the constants + the route helpers directly.

/** 1-indexed step number passed to <OnboardingShell currentStep={…} />. */
export const SERVICE_STEP_INDEX: 1 | 2 | 3 | 4 = 2;

/** H1 displayed by the shell. Pinned by tests + architecture §6. */
export const SERVICE_STEP_TITLE = "Add your first service.";

/**
 * Subtitle copy. Reassures the producer that this isn't a final
 * decision — they can fill out a service now or skip and return to
 * Setup → Services later. Pin a substring (later/skip/change/edit)
 * by the test so a future copy edit that goes formal/legalese forces
 * a deliberate update.
 */
export const SERVICE_STEP_SUBTITLE =
  "Sketch out one of your services so clients can book. You can edit it later or add more from Setup.";

/**
 * OnboardingStep tag for this page. Passed to decideOnboardingRedirect
 * + (in future stories) the telemetry helpers, so the wire-format
 * "service" string lives in exactly one place. A typo here (e.g.
 * "services") would silently fall back to the default-arg "studio"
 * branch in the redirect helper, which is the kind of failure that's
 * easy to miss in manual QA — pinning it via a test catches it.
 */
export const ONBOARDING_STEP_NAME: OnboardingStep = "service";

/**
 * Step 2 → Step 3 route after a successful createPackage. The
 * NewPackageForm calls onClose() on success; the Step 2 page hijacks
 * that callback to push to nextRouteAfterService(). Same destination
 * as Skip — the only difference is whether createPackage ran (and the
 * matching telemetry event).
 */
export function nextRouteAfterService(): "/onboarding/availability" {
  return "/onboarding/availability";
}

/**
 * Step 2 Skip-ghost-link target. Identical to nextRouteAfterService
 * — Skip and Continue both forward to Step 3. Telemetry distinguishes
 * the two (step_completed vs step_skipped), but routing does not.
 *
 * Kept as its own helper (rather than re-exporting nextRouteAfterService)
 * so a future divergence (e.g. Skip jumps straight to /dashboard if
 * we add a "minimal viable producer" path) is a single-line change
 * and the test asserts the current invariant (they're aligned today).
 */
export function routeOnSkipFromService(): "/onboarding/availability" {
  return "/onboarding/availability";
}

export default async function ServiceStepPage() {
  // Page-level role guard. The layout already enforces the artist +
  // unauthenticated walls (story 04 doesn't change that), but the
  // layout's call defaults `currentStep="studio"` which redirects
  // producer-complete users to /dashboard. Re-run with the
  // step-aware arg so producer-complete on /onboarding/service is
  // allowed to render (mid-flow continuation after Step 1).
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, ONBOARDING_STEP_NAME);
  if (redirectTo) redirect(redirectTo);

  return <ServiceStepClient />;
}
