"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createPackage } from "~/app/(producer)/dashboard/booking/actions";
import { buildPackagePayload } from "~/app/(producer)/dashboard/store/build-package-payload";
import { IncludesStep } from "~/app/(producer)/dashboard/store/editor-steps/includes-step";
import { LogisticsStep } from "~/app/(producer)/dashboard/store/editor-steps/logistics-step";
import { PaymentStep } from "~/app/(producer)/dashboard/store/editor-steps/payment-step";
import { PricingStep } from "~/app/(producer)/dashboard/store/editor-steps/pricing-step";
import {
  ReviewStep,
  type ReviewEditStep,
} from "~/app/(producer)/dashboard/store/editor-steps/review-step";
import { RightsAgreementStep } from "~/app/(producer)/dashboard/store/editor-steps/rights-agreement-step";
import { TypeStep } from "~/app/(producer)/dashboard/store/editor-steps/type-step";
import {
  buildPaymentPlans,
  hasPaymentOption,
  royaltyDraftToTerms,
  royaltyTermsToDraft,
  seedPaymentSelection,
  validateAgreementDraft,
  validateRoyaltyDraft,
  type AgreementMode,
  type PaymentSelectionDraft,
  type ProductRoyaltyDraft,
} from "~/app/(producer)/dashboard/store/product-editor-draft";
import { StepBar } from "~/app/(producer)/dashboard/store/step-bar";
import {
  getPreset,
  type PaymentPlanChoice,
  type PresetId,
  type PresetType,
} from "~/app/(producer)/dashboard/store/type-presets";
import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useToast } from "~/components/ui/toast";
import type { VolumeTier } from "~/lib/pricing";

import {
  SERVICE_STEP_INDEX,
  nextRouteAfterService,
  routeOnBackFromService,
} from "./constants";

// Onboarding uses the same seven-part product authoring flow as the Store
// editor, rendered inline inside WizardChrome instead of in a dialog. The
// first-service version intentionally stays flat-price-only and does not
// expose producer-level tax controls, but its saved product contract is the
// same: multiple payment options, structured rights, dedicated agreement
// fields, deliverables, and a final Review gate.

type Currency = "USD" | "EUR" | "GBP" | "ILS";
type StepId =
  | "type"
  | "details"
  | "price"
  | "payment"
  | "delivery"
  | "rights"
  | "review";

const STEPS: readonly StepId[] = [
  "type",
  "details",
  "price",
  "payment",
  "delivery",
  "rights",
  "review",
] as const;

const STEP_TITLES: Record<StepId, string> = {
  type: "What are you offering?",
  details: "Product details",
  price: "Price",
  payment: "Payment options",
  delivery: "Delivery",
  rights: "Rights & agreement",
  review: "Review",
};

const STEP_SUBTITLES: Record<StepId, string> = {
  type: "Pick the closest match. We'll prefill the rest.",
  details: "Name the offer and choose what's included.",
  price: "Set the price and session scope.",
  payment: "Choose one or more. The artist picks after approval.",
  delivery: "Set the session length and included revisions.",
  rights: "Define the headline rights and optional agreement.",
  review: "Check every term before creating the product.",
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
  payment: PaymentSelectionDraft;
  includes: string[];
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  agreementMode: AgreementMode;
  contractUrl: string;
  agreementText: string;
  royalty: ProductRoyaltyDraft;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
}

function paymentSelectionForPreset(
  choice: PaymentPlanChoice,
): PaymentSelectionDraft {
  if (choice === "split") {
    return seedPaymentSelection([{ kind: "split_50_50" }]);
  }
  if (choice === "installments") {
    return seedPaymentSelection([{ kind: "monthly", installments: 4 }]);
  }
  return seedPaymentSelection([{ kind: "full" }]);
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
    payment: seedPaymentSelection([{ kind: "full" }]),
    includes: [],
    duration: "60 min",
    revisions: 0,
    unlimitedRevisions: false,
    agreementMode: "none",
    contractUrl: "",
    agreementText: "",
    royalty: royaltyTermsToDraft(null),
    pricingModel: "flat",
    volumeTiers: [],
  };
}

const VALID_CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "ILS"];

function narrowCurrency(currency: string): Currency {
  return (VALID_CURRENCIES as readonly string[]).includes(currency)
    ? (currency as Currency)
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
  const [returnToReview, setReturnToReview] = useState(false);

  const currentIdx = Math.max(0, STEPS.indexOf(currentStep));
  const isFirstInner = currentIdx === 0;
  const isLastInner = currentIdx === STEPS.length - 1;

  const paymentError = (() => {
    if (!hasPaymentOption(draft.payment)) {
      return "Choose at least one payment option.";
    }
    try {
      buildPaymentPlans(draft.payment);
      return null;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Check the payment options.";
    }
  })();
  const royaltyErrors = validateRoyaltyDraft(draft.royalty, true);
  const agreementError = validateAgreementDraft(
    draft.agreementMode,
    draft.contractUrl,
    draft.agreementText,
  );
  const royaltyIsValid =
    royaltyErrors.master === undefined &&
    royaltyErrors.composition === undefined &&
    agreementError === null;
  const reviewPaymentPlans = paymentError
    ? []
    : buildPaymentPlans(draft.payment);
  const reviewRoyaltyTerms = royaltyDraftToTerms(draft.royalty);
  const pickedPreset = draft._picked ? getPreset(draft._picked) : undefined;
  const typeLabel =
    draft._picked === "blank" ? "Custom" : (pickedPreset?.label ?? "Custom");

  function onPickPreset(id: PresetId) {
    const preset = getPreset(id);
    if (!preset) return;
    setDraft((current) => ({
      ...current,
      _picked: id,
      type: preset.preset.type,
      name:
        current.name.trim().length > 0
          ? current.name
          : preset.defaultName,
      price: preset.preset.price,
      sessions: preset.preset.sessions,
      unlimitedSessions: preset.preset.unlimitedSessions,
      payment: paymentSelectionForPreset(preset.preset.paymentPlan),
      includes: [...preset.baseline],
      duration:
        preset.preset.duration === "multi-session"
          ? "60 min"
          : preset.preset.duration,
      revisions: preset.preset.revisions,
      pricingModel: "flat",
      volumeTiers: [],
    }));
    setCurrentStep("details");
  }

  const canContinue: boolean = (() => {
    if (currentStep === "type") return draft._picked !== null;
    if (currentStep === "details") {
      return (
        draft.name.trim().length > 0 &&
        draft.name.trim().length <= 200 &&
        draft.includes.length <= 10 &&
        draft.includes.every(
          (item) => item.trim().length > 0 && item.trim().length <= 100,
        )
      );
    }
    if (currentStep === "price") return draft.price >= 0;
    if (currentStep === "payment") return paymentError === null;
    if (currentStep === "delivery") {
      return /^\d+\s*min$/i.test(draft.duration);
    }
    if (currentStep === "rights") return royaltyIsValid;
    return paymentError === null && royaltyIsValid;
  })();

  function goBack() {
    setReturnToReview(false);
    if (isFirstInner) {
      router.push(routeOnBackFromService());
      return;
    }
    const previous = STEPS[currentIdx - 1];
    if (previous) setCurrentStep(previous);
  }

  function goNext() {
    if (!canContinue) return;
    if (returnToReview) {
      setReturnToReview(false);
      setCurrentStep("review");
      return;
    }
    if (isLastInner) {
      save();
      return;
    }
    const next = STEPS[currentIdx + 1];
    if (next) setCurrentStep(next);
  }

  function save() {
    if (currentStep !== "review") return;
    if (paymentError || !royaltyIsValid) return;

    // The shared pure mapper keeps onboarding and Store persistence in
    // lockstep. It writes inclusions to deliverables, structures rights,
    // stores link/text separately, and encodes only tagline + revisions in
    // description (never inline agreement text).
    const payload = buildPackagePayload(draft);

    startTransition(async () => {
      const result = await createPackage(payload);
      if (result.ok) {
        toast(`${draft.name.trim() || "Service"} saved.`, "success");
        router.push(nextRouteAfterService());
      } else {
        toast(result.error, "error");
      }
    });
  }

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

        <div key={currentStep} className="mt-5 sk-step-enter">
          {currentStep === "type" ? (
            <TypeStep picked={draft._picked} onPick={onPickPreset} />
          ) : null}

          {currentStep === "details" ? (
            <IncludesStep
              pickedId={draft._picked}
              name={draft.name}
              onNameChange={(name) => {
                setDraft((current) => ({ ...current, name }));
              }}
              includes={draft.includes}
              onIncludesChange={(includes) => {
                setDraft((current) => ({ ...current, includes }));
              }}
            />
          ) : null}

          {currentStep === "price" ? (
            <PricingStep
              price={draft.price}
              currency={draft.currency}
              sessions={draft.sessions}
              unlimitedSessions={draft.unlimitedSessions}
              showPaymentPlans={false}
              pricingModel="flat"
              volumeTiers={[]}
              allowPerSong={false}
              onChange={(patch) => {
                setDraft((current) => ({
                  ...current,
                  ...patch,
                  pricingModel: "flat",
                  volumeTiers: [],
                }));
              }}
            />
          ) : null}

          {currentStep === "payment" ? (
            <PaymentStep
              selection={draft.payment}
              previewTotalCents={Math.round(draft.price * 100)}
              currency={draft.currency}
              pricingModel="flat"
              {...(paymentError ? { error: paymentError } : {})}
              onChange={(payment) => {
                setDraft((current) => ({ ...current, payment }));
              }}
            />
          ) : null}

          {currentStep === "delivery" ? (
            <LogisticsStep
              duration={draft.duration}
              revisions={draft.revisions}
              unlimitedRevisions={draft.unlimitedRevisions}
              onChange={(patch) => {
                setDraft((current) => ({ ...current, ...patch }));
              }}
            />
          ) : null}

          {currentStep === "rights" ? (
            <RightsAgreementStep
              royalty={draft.royalty}
              agreementMode={draft.agreementMode}
              contractUrl={draft.contractUrl}
              agreementText={draft.agreementText}
              errors={royaltyErrors}
              {...(agreementError ? { agreementError } : {})}
              onRoyaltyChange={(royalty) => {
                setDraft((current) => ({ ...current, royalty }));
              }}
              onAgreementChange={(patch) => {
                setDraft((current) => ({ ...current, ...patch }));
              }}
            />
          ) : null}

          {currentStep === "review" ? (
            <ReviewStep
              name={draft.name.trim()}
              typeLabel={typeLabel}
              showTypeEdit={true}
              includes={draft.includes}
              pricingModel="flat"
              priceCents={Math.round(draft.price * 100)}
              currency={draft.currency}
              sessions={draft.sessions}
              unlimitedSessions={draft.unlimitedSessions}
              paymentPlans={reviewPaymentPlans}
              duration={draft.duration}
              revisions={draft.revisions}
              unlimitedRevisions={draft.unlimitedRevisions}
              royaltyTerms={reviewRoyaltyTerms}
              agreementMode={draft.agreementMode}
              contractUrl={draft.contractUrl}
              agreementText={draft.agreementText}
              onEdit={(step: ReviewEditStep) => {
                setReturnToReview(true);
                setCurrentStep(step);
              }}
            />
          ) : null}
        </div>
      </div>
    </WizardChrome>
  );
}
