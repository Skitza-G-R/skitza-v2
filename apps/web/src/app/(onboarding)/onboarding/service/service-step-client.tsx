"use client";

import { useRouter } from "next/navigation";

import { NewPackageForm } from "~/app/(producer)/dashboard/booking/package-form";
import { OnboardingShell } from "~/app/(onboarding)/onboarding/shell";

import {
  SERVICE_STEP_INDEX,
  SERVICE_STEP_SUBTITLE,
  SERVICE_STEP_TITLE,
  nextRouteAfterService,
  routeOnBackFromService,
  routeOnSkipFromService,
} from "./constants";

type SupportedCurrency = "USD" | "EUR" | "GBP" | "ILS";

export interface ServiceStepClientProps {
  /**
   * Producer's default_currency from Step 1 (set by completeStudio
   * via x-vercel-ip-country / accept-language inference). When passed,
   * NewPackageForm pre-selects this in the currency dropdown so the
   * producer doesn't have to manually change USD → ILS / EUR / GBP.
   * Optional — falls back to NewPackageForm's own USD default when
   * undefined (e.g. orphan producer-incomplete row, edge cases).
   */
  initialCurrency?: SupportedCurrency;
}

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

export function ServiceStepClient({ initialCurrency }: ServiceStepClientProps = {}) {
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

  // T8 — Back hops to the new /onboarding/services step (the role-
  // wall concern that previously suppressed Back is moot now: services
  // is a non-studio step and producer-complete on non-studio renders.)
  const goBackToServices = () => {
    router.push(routeOnBackFromService());
  };

  return (
    <OnboardingShell
      currentStep={SERVICE_STEP_INDEX}
      title={SERVICE_STEP_TITLE}
      subtitle={SERVICE_STEP_SUBTITLE}
      onBack={goBackToServices}
      onSkip={skipToAvailability}
      // No onContinue — NewPackageForm hosts its own submit in the
      // content slot. The action bar renders only Skip for this step
      // (the helper at action-bar.tsx::shouldRenderContinue omits the
      // button when the handler is undefined).
    >
      <NewPackageForm
        onClose={advanceToAvailability}
        // The Payment plans selector below the price (Pay in full /
        // 50-50 / monthly installments) is the structured way producers
        // pick their upfront-vs-deferred schedule. The legacy "Deposit
        // percent" numeric input duplicates that choice in a confusing
        // way — hiding it keeps Step 2 focused on the producer's mental
        // model. Setup → Services still shows the field for power users
        // who want to fine-tune the flat-deposit path independently.
        hideDepositField
        // Pre-select the producer's default currency (inferred in Step 1)
        // so an Israeli producer doesn't see USD pre-filled. Spread to
        // satisfy exactOptionalPropertyTypes — passing undefined would be
        // rejected by tsc.
        {...(initialCurrency ? { initialCurrency } : {})}
      />
    </OnboardingShell>
  );
}
