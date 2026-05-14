"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PaymentPlan } from "@skitza/db";

import {
  createPackage,
  type PackageKind,
} from "~/app/(producer)/dashboard/booking/actions";
import {
  ContractStep,
  type ContractMode,
} from "~/app/(producer)/dashboard/store/editor-steps/contract-step";
import { IncludesStep } from "~/app/(producer)/dashboard/store/editor-steps/includes-step";
import { LogisticsStep } from "~/app/(producer)/dashboard/store/editor-steps/logistics-step";
import { PricingStep } from "~/app/(producer)/dashboard/store/editor-steps/pricing-step";
import { TypeStep } from "~/app/(producer)/dashboard/store/editor-steps/type-step";
import { encodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { StepBar } from "~/app/(producer)/dashboard/store/step-bar";
import {
  getPreset,
  type PaymentPlanChoice,
  type PresetId,
  type PresetType,
} from "~/app/(producer)/dashboard/store/type-presets";
import { useToast } from "~/components/ui/toast";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";

import {
  SERVICE_STEP_INDEX,
  nextRouteAfterService,
  routeOnBackFromService,
} from "./constants";

// Step 2 — First service. Path B (May 2026 redesign, take 2): the
// producer goes through the same 5 inner sub-steps that
// /dashboard/store's ProductEditor uses (Type / Includes / Pricing /
// Logistics / Agreement), but rendered inline inside WizardChrome
// instead of in a Radix Dialog. Same step components, same Draft
// shape, same createPackage save path — so the producer learns the
// flow once and meets it again when they add product #2 later.
//
// What's different from the store's ProductEditor:
//   - No modal chrome (EditorShell). The wizard's WizardChrome
//     already owns the page, so a modal-on-page nested feel is
//     avoided.
//   - The wizard's sticky WizardFooter owns Back / Continue / Save.
//     Inner-step routing happens here; outer-step routing happens
//     on first-step Back and last-step Save.
//   - No `onCreated` shimmer-glow callback. There's no card to
//     animate on — the next screen is /onboarding/availability.

type Currency = "USD" | "EUR" | "GBP" | "ILS";
type StepId = "type" | "includes" | "pricing" | "logistics" | "agreement";

const STEPS: readonly StepId[] = [
  "type",
  "includes",
  "pricing",
  "logistics",
  "agreement",
] as const;

const STEP_TITLES: Record<StepId, string> = {
  type: "What are you offering?",
  includes: "What's included",
  pricing: "Pricing and terms",
  logistics: "Logistics",
  agreement: "Agreement",
};

const STEP_SUBTITLES: Record<StepId, string> = {
  type: "Pick the closest match. We'll prefill the rest.",
  includes: "Tap to add. Artists see this list before they book.",
  pricing: "Price, how many sessions, and how they pay.",
  logistics: "Session length and how many revisions are included.",
  agreement: "Optional. Attach a contract or write your terms.",
};

interface Draft {
  _picked: PresetId | null;
  name: string;
  tagline: string;
  type: PresetType;
  price: number;
  currency: Currency;
  sessions: number;
  unlimitedSessions: boolean;
  paymentPlan: PaymentPlanChoice;
  installmentsCount: number;
  includes: string[];
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  contractMode: ContractMode;
  contractUrl: string;
  contractText: string;
}

function emptyDraft(currency: Currency): Draft {
  return {
    _picked: null,
    name: "",
    tagline: "",
    type: "consult",
    price: 0,
    currency,
    sessions: 1,
    unlimitedSessions: false,
    paymentPlan: "full",
    installmentsCount: 3,
    includes: [],
    duration: "60 min",
    revisions: 0,
    unlimitedRevisions: false,
    contractMode: "link",
    contractUrl: "",
    contractText: "",
  };
}

// Currency-narrowed default — onboarding's page reads
// producers.default_currency and forwards it. Anything outside the
// 4-enum slips back to USD via this guard.
const VALID_CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "ILS"];

function narrowCurrency(c: string): Currency {
  return (VALID_CURRENCIES as readonly string[]).includes(c)
    ? (c as Currency)
    : "USD";
}

export function ServiceStepClient({
  defaultCurrency,
}: {
  defaultCurrency: Currency;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(narrowCurrency(defaultCurrency)),
  );
  const [currentStep, setCurrentStep] = useState<StepId>("type");

  const currentIdx = Math.max(0, STEPS.indexOf(currentStep));
  const isFirstInner = currentIdx === 0;
  const isLastInner = currentIdx === STEPS.length - 1;

  function onPickPreset(id: PresetId) {
    const preset = getPreset(id);
    if (!preset) return;
    setDraft((d) => ({
      ...d,
      _picked: id,
      type: preset.preset.type,
      name: d.name.trim().length > 0 ? d.name : preset.defaultName,
      price: preset.preset.price,
      sessions: preset.preset.sessions,
      unlimitedSessions: preset.preset.unlimitedSessions,
      paymentPlan: preset.preset.paymentPlan,
      includes: [...preset.baseline],
      duration: preset.preset.duration === "multi-session" ? "60 min" : preset.preset.duration,
      revisions: preset.preset.revisions,
      contractMode: "link",
    }));
    // Auto-advance like the store wizard does — picking a preset is
    // the answer to step 1, so the producer shouldn't have to hit
    // Continue separately.
    setCurrentStep("includes");
  }

  // Gating mirrors ProductEditor.canContinue exactly so onboarding
  // and the store agree on what "ready to advance" means.
  const canContinue: boolean = (() => {
    if (currentStep === "type") return draft._picked != null;
    if (currentStep === "includes") return draft.name.trim() !== "";
    if (currentStep === "pricing") return draft.price >= 0;
    if (currentStep === "logistics") {
      return /^\d+\s*min$/i.test(draft.duration);
    }
    return true; // agreement is skippable
  })();

  function goBack() {
    if (isFirstInner) {
      // First inner step: exit outwards to the previous outer step.
      router.push(routeOnBackFromService());
      return;
    }
    const prev = STEPS[currentIdx - 1];
    if (prev) setCurrentStep(prev);
  }

  function goNext() {
    if (isLastInner) {
      save();
      return;
    }
    const next = STEPS[currentIdx + 1];
    if (next) setCurrentStep(next);
  }

  function save() {
    const description = encodeDescription({
      tagline: draft.tagline,
      revisions: draft.revisions,
      unlimitedRevisions: draft.unlimitedRevisions,
      contractText: draft.contractMode === "text" ? draft.contractText : "",
    });
    const durationMatch = draft.duration.match(/(\d+)\s*min/i);
    const durationMin = durationMatch
      ? parseInt(durationMatch[1] ?? "0", 10)
      : 0;
    const sessionCount = draft.unlimitedSessions
      ? 0
      : Math.max(1, draft.sessions);
    const paymentPlans: PaymentPlan[] = (() => {
      if (draft.paymentPlan === "full") return [{ kind: "full" }];
      if (draft.paymentPlan === "split") return [{ kind: "split_50_50" }];
      return [
        {
          kind: "monthly",
          installments: Math.max(2, draft.installmentsCount),
        },
      ];
    })();
    const priceCents = Math.round(draft.price * 100);
    const trimmedUrl = draft.contractUrl.trim();
    const contractUrlOut: string | null =
      draft.contractMode === "text"
        ? null
        : trimmedUrl.length > 0
          ? trimmedUrl
          : null;

    const payload = {
      name: draft.name.trim(),
      description,
      // "consult" is the wizard's blank-preset internal type; the DB
      // PackageKind enum has no "consult" variant, so it routes to
      // "other" the same way the store wizard does for new products.
      kind:
        draft.type === "consult"
          ? ("other" as PackageKind)
          : (draft.type as PackageKind),
      priceCents,
      currency: draft.currency,
      durationMin,
      sessionCount,
      paymentPlans,
      depositPct: 0,
      contractUrl: contractUrlOut,
    };

    startTransition(async () => {
      const res = await createPackage(payload);
      if (res.ok) {
        toast(
          `${draft.name.trim() || "Service"} saved.`,
          "success",
        );
        router.push(nextRouteAfterService());
      } else {
        toast(res.error, "error");
      }
    });
  }

  // Continue copy:
  //   - Last inner step + pending → "Saving…"
  //   - Last inner step → "Save and continue"
  //   - Earlier inner step → "Continue"
  const continueLabel = isLastInner ? "Save and continue" : "Continue";

  return (
    <WizardChrome
      activePosition={SERVICE_STEP_INDEX}
      stepIndicator="Step 2 of 5"
      footer={
        <WizardFooter
          onBack={goBack}
          onContinue={goNext}
          continueLabel={continueLabel}
          continueDisabled={!canContinue}
          pending={pending}
        />
      }
    >
      <div className="ob-stagger">
        {/* "NEW SERVICE" eyebrow + dashed StepBar. The outer step
            rail (left sidebar) + WizardChrome header already render
            the outer "Step 2 of 5" position; adding a second numeric
            step indicator here would compete with it. The eyebrow
            stays purely thematic, and the dashed StepBar carries the
            inner sub-step progress on its own. Same StepBar component
            the store wizard uses so the affordance is identical
            across surfaces. */}
        <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          New service
        </p>
        <h1
          className="mt-2 font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {STEP_TITLES[currentStep]}
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-snug text-[rgb(var(--fg-muted))]">
          {STEP_SUBTITLES[currentStep]}
        </p>
        <div className="mt-4">
          <StepBar steps={STEPS} current={currentStep} />
        </div>

        {/* Active sub-step body. Keyed on currentStep so each sub-step
            replays the ob-stagger entrance — small motion cue that the
            page is fresh, never jarring. */}
        <div key={currentStep} className="mt-5 sk-step-enter">
          {currentStep === "type" && (
            <TypeStep picked={draft._picked} onPick={onPickPreset} />
          )}
          {currentStep === "includes" && (
            <IncludesStep
              pickedId={draft._picked}
              name={draft.name}
              onNameChange={(name) => {
                setDraft((d) => ({ ...d, name }));
              }}
              includes={draft.includes}
              onIncludesChange={(includes) => {
                setDraft((d) => ({ ...d, includes }));
              }}
            />
          )}
          {currentStep === "pricing" && (
            <PricingStep
              price={draft.price}
              currency={draft.currency}
              sessions={draft.sessions}
              unlimitedSessions={draft.unlimitedSessions}
              paymentPlan={draft.paymentPlan}
              installmentsCount={draft.installmentsCount}
              onChange={(patch) => {
                setDraft((d) => ({ ...d, ...patch }));
              }}
            />
          )}
          {currentStep === "logistics" && (
            <LogisticsStep
              duration={draft.duration}
              revisions={draft.revisions}
              unlimitedRevisions={draft.unlimitedRevisions}
              onChange={(patch) => {
                setDraft((d) => ({ ...d, ...patch }));
              }}
            />
          )}
          {currentStep === "agreement" && (
            <ContractStep
              mode={draft.contractMode}
              contractUrl={draft.contractUrl}
              contractText={draft.contractText}
              onChange={(patch) => {
                // ContractStep emits its panel-selector field as
                // `mode`; the Draft stores it as `contractMode` to
                // disambiguate from PaymentPlanChoice (paymentPlan).
                // Translate explicitly so a Text-tab click actually
                // swaps panels instead of silently growing a dead
                // `mode` key on Draft. Same fix is applied in
                // dashboard/store/product-editor.tsx.
                const { mode, ...rest } = patch;
                setDraft((d) => ({
                  ...d,
                  ...rest,
                  ...(mode !== undefined ? { contractMode: mode } : {}),
                }));
              }}
            />
          )}
        </div>
      </div>
    </WizardChrome>
  );
}
