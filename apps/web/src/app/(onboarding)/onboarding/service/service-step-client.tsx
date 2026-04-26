"use client";

import { useRouter } from "next/navigation";

import { NewPackageForm } from "~/app/(app)/dashboard/booking/package-form";
import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";

import {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_SUBTITLE,
  SERVICE_STEP_TITLE,
  nextRouteAfterService,
  routeOnSkipFromService,
} from "./constants";

// Story 04 — Step 2 client wrapper.
//
// Server-side guard runs in page.tsx (the default export of this
// route). Once that gate clears, this component renders the wizard
// shell with the existing NewPackageForm in pure CREATE mode.
//
// Why split server / client like this:
//   • The page.tsx default export is a Server Component because the
//     role gate uses `auth()` + Drizzle (`fetchUserRole`) — both
//     require server-only execution.
//   • OnboardingShell + NewPackageForm both `"use client"` (state +
//     useRouter + useTransition), so the shell-and-form pair has to
//     be hosted by a client component.
//   • Hosting the form in a client component also lets us hijack
//     NewPackageForm's onClose() callback to push the producer to
//     Step 3 after a successful create — without modifying the form
//     itself (which is shared with the producer's permanent Setup →
//     Services surface).
//
// NewPackageForm contract reused exactly as designed:
//   • No initialValues  → CREATE mode, defaults at package-form.tsx:104-134
//   • No fromTemplate   → onConflict-style upsert, real createPackage call
//   • onClose()         → success callback (misnamed historically). We
//                         wire it to push to /onboarding/availability so
//                         the producer flows into Step 3 the moment
//                         createPackage resolves.
//
// The Continue button in the shell is intentionally omitted —
// NewPackageForm has its own primary submit ("Save service") inside
// the content slot, and surfacing both would be visually noisy +
// confusing about which one persists state. The action bar still
// shows Back (← Step 1) and Skip for now (forward to Step 3 without
// saving), which is the affordance set Step 2 needs.

export function ServiceStepClient() {
  const router = useRouter();

  // Both Skip and form-success forward to the same path. The
  // distinction in user intent shows up in telemetry only — Story 04
  // notes step_completed (form save) vs step_skipped (Skip click)
  // both with `{ step: "service" }`. Telemetry helper doesn't exist
  // yet (TODO referenced in studio/page.tsx Story 03 too); the routes
  // are correct now and the events get added as a follow-up so the
  // form save isn't blocked on an analytics PR.
  const advanceToAvailability = () => {
    router.push(nextRouteAfterService());
  };

  const skipToAvailability = () => {
    router.push(routeOnSkipFromService());
  };

  const goBackToStudio = () => {
    router.push("/onboarding/studio");
  };

  return (
    <OnboardingShell
      currentStep={SERVICE_STEP_INDEX}
      title={SERVICE_STEP_TITLE}
      subtitle={SERVICE_STEP_SUBTITLE}
      onBack={goBackToStudio}
      onSkip={skipToAvailability}
      // No onContinue — NewPackageForm hosts its own submit in the
      // content slot. The action bar renders only Back + Skip for this
      // step (the helper at action-bar.tsx::shouldRenderContinue
      // omits the button when the handler is undefined).
    >
      <NewPackageForm onClose={advanceToAvailability} />
    </OnboardingShell>
  );
}
