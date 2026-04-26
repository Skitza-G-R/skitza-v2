"use client";

import { useRouter } from "next/navigation";

import {
  AvailabilitySection,
  type AvailabilityBlock,
  type AvailabilitySettings,
  type Blackout,
} from "~/components/dashboard/setup/availability-section";
import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";

import {
  AVAILABILITY_CONTINUE_ALWAYS_ENABLED,
  AVAILABILITY_STEP_INDEX,
  AVAILABILITY_STEP_SUBTITLE,
  AVAILABILITY_STEP_TITLE,
  nextRouteAfterAvailability,
  routeOnBackFromAvailability,
  routeOnSkipFromAvailability,
} from "./constants";

// Story 05 — Step 3 client wrapper.
//
// Server-side guard runs in page.tsx (the default export of this
// route). Once that gate clears, this component renders the wizard
// shell with the existing AvailabilitySection composite + its 5
// child islands.
//
// Why split server / client like this:
//   • The page.tsx default export is a Server Component because the
//     role gate uses `auth()` + Drizzle (`fetchUserRole`) and the
//     three booking.* procedures (availability.list / blackouts.list /
//     availability.getSettings) — all server-only.
//   • OnboardingShell + every child editor inside AvailabilitySection
//     all `"use client"` (state + useRouter + useTransition), so the
//     shell-and-section pair must be hosted by a client component.
//   • Hosting the section in a client component lets the shell wire
//     Continue / Skip / Back navigation without the children needing
//     to know they're inside the wizard at all — direct reuse, no
//     adapter wrapper.
//
// AvailabilitySection contract reused exactly:
//   • blocks[] / blackouts[] / settings — same shape Setup → Availability
//     consumes today (the source page maps tRPC rows the same way at
//     apps/web/src/app/(app)/dashboard/booking/page.tsx:173-186).
//   • Each child editor handles its own writes via existing
//     producer-procedure mutations + uses router.refresh() to
//     re-render the parent after mutate. router.refresh() works on
//     /onboarding/availability identically to /dashboard/booking —
//     no hardcoded /dashboard/* pushes inside the children. Verified
//     by direct read of all 5 child sources.
//
// Continue is always enabled (acceptance criteria #7): the children
// auto-save on change so the producer can advance with whatever
// they've configured (including nothing). Skip and Continue both go
// to the same destination (/onboarding/portfolio); telemetry
// distinguishes the two events but the routing is identical.

export function AvailabilityStepClient({
  blocks,
  blackouts,
  settings,
}: {
  blocks: AvailabilityBlock[];
  blackouts: Blackout[];
  settings: AvailabilitySettings;
}) {
  const router = useRouter();

  // Continue advances to Step 4. Telemetry helper isn't wired yet
  // (TODO referenced in Stories 03 + 04 too); the routes are correct
  // now and step_completed events get added as a follow-up so the
  // shell isn't blocked on an analytics PR.
  const advanceToPortfolio = () => {
    router.push(nextRouteAfterAvailability());
  };

  const skipToPortfolio = () => {
    router.push(routeOnSkipFromAvailability());
  };

  const goBackToService = () => {
    router.push(routeOnBackFromAvailability());
  };

  return (
    <OnboardingShell
      currentStep={AVAILABILITY_STEP_INDEX}
      title={AVAILABILITY_STEP_TITLE}
      subtitle={AVAILABILITY_STEP_SUBTITLE}
      onBack={goBackToService}
      onSkip={skipToPortfolio}
      onContinue={advanceToPortfolio}
      // Continue is always enabled — children auto-save on change
      // (see AVAILABILITY_CONTINUE_ALWAYS_ENABLED in page.tsx).
      continueDisabled={!AVAILABILITY_CONTINUE_ALWAYS_ENABLED}
    >
      <AvailabilitySection
        blocks={blocks}
        blackouts={blackouts}
        settings={settings}
      />
    </OnboardingShell>
  );
}
