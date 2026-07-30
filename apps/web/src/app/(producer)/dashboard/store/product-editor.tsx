"use client";

import type { PaymentPlan } from "@skitza/db";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createPackage, updatePackage } from "~/app/(producer)/dashboard/booking/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import type {
  ProducerStoreDraftStep,
  ProducerStoreProductDraft,
} from "~/lib/runtime-state/runtime-state";
import { applyTaxToCents, taxModeFootnote } from "~/lib/tax-mode";

import { buildPackagePayload, buildPackageUpdatePayload } from "./build-package-payload";
import { decodeDescription } from "./description-encoding";
import { IncludesStep } from "./editor-steps/includes-step";
import { LogisticsStep } from "./editor-steps/logistics-step";
import { PaymentStep } from "./editor-steps/payment-step";
import { PricingStep } from "./editor-steps/pricing-step";
import { ReviewStep, type ReviewEditStep } from "./editor-steps/review-step";
import { RightsAgreementStep } from "./editor-steps/rights-agreement-step";
import { TypeStep } from "./editor-steps/type-step";
import { EditorShell } from "./editor-shell";
import { kindToTile } from "./kind-to-tile";
import {
  buildPaymentPlans,
  hasPaymentOption,
  productCashPriceError,
  paymentPlanFeasibilityError,
  productTaglineError,
  royaltyDraftToTerms,
  royaltyTermsToDraft,
  seedPaymentSelection,
  seedStoreAgreementDraft,
  validateAgreementDraft,
  validateRoyaltyDraft,
} from "./product-editor-draft";
import type { StoreProduct } from "./store-screen";
import { getPreset, type PaymentPlanChoice, type PresetId, type PresetType } from "./type-presets";

type Currency = "USD" | "EUR" | "GBP" | "ILS";
type StepId = ProducerStoreDraftStep;

const NEW_STEPS: readonly StepId[] = [
  "type",
  "details",
  "price",
  "payment",
  "delivery",
  "rights",
  "review",
];
const EDIT_STEPS: readonly StepId[] = [
  "details",
  "price",
  "payment",
  "delivery",
  "rights",
  "review",
];

const STEP_TITLES: Record<StepId, string> = {
  type: "What are you offering?",
  details: "Product details",
  price: "Price",
  payment: "Payment options",
  delivery: "Delivery",
  rights: "Rights & agreement",
  review: "Review your product",
};

const STEP_SUBTITLES: Record<StepId, string> = {
  type: "Pick the closest match. We'll prefill the practical details.",
  details: "Add the title, short description, and deliverables artists will see.",
  price: "Choose a pricing model and see the artist's total.",
  payment: "Choose one or more. The artist picks after approval.",
  delivery: "Choose whether artists can book time, then set delivery details.",
  rights: "Define headline master and composition terms, then add an optional agreement.",
  review: "Check every term before this product is created or updated.",
};

type PersistedDraft = ProducerStoreProductDraft["draft"];
type Draft = Omit<PersistedDraft, "includesSessions"> & {
  includesSessions: boolean;
};

interface ProductEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: StoreProduct | null;
  defaultCurrency: Currency;
  taxMode: import("~/lib/tax-mode").TaxMode;
  taxRatePct: number;
  producerName?: string;
  previewPlacement?: "focal" | "secondary";
  onCreated?: (id: string) => void;
  onSubmitted: () => void;
  onDiscardDraft?: () => void;
  persistedDraft: ProducerStoreProductDraft | null;
  onPersistDraft: (draft: ProducerStoreProductDraft) => boolean;
}

const VALID_CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "ILS"];

function plansForPreset(choice: PaymentPlanChoice): PaymentPlan[] {
  if (choice === "full") return [{ kind: "full" }];
  if (choice === "split") return [{ kind: "split_50_50" }];
  return [{ kind: "monthly", installments: 4 }];
}

function emptyDraft(currency: Currency): Draft {
  return {
    _picked: null,
    _legacyAgreementLink: false,
    name: "",
    tagline: "",
    type: "consult",
    price: 0,
    currency,
    includesSessions: false,
    sessions: 1,
    unlimitedSessions: false,
    payment: seedPaymentSelection([{ kind: "full" }]),
    includes: [],
    duration: "60 min",
    revisions: 0,
    unlimitedRevisions: false,
    agreementMode: "none",
    agreementText: "",
    royalty: royaltyTermsToDraft(null),
    pricingModel: "flat",
    volumeTiers: [],
  };
}

function normalizeDraft(draft: PersistedDraft): Draft {
  return {
    ...draft,
    includesSessions: draft.includesSessions ?? /^\d+\s*min$/i.test(draft.duration),
  };
}

function kindToPresetType(kind: string): PresetType {
  return kindToTile(kind);
}

function seedDraftFromProduct(product: StoreProduct, defaultCurrency: Currency): Draft {
  const decoded = decodeDescription(product.description);
  const currency = (VALID_CURRENCIES as readonly string[]).includes(product.currency)
    ? (product.currency as Currency)
    : defaultCurrency;
  const dedicatedAgreement = product.agreementText ?? decoded.contractText;
  const agreement = seedStoreAgreementDraft(dedicatedAgreement, product.contractUrl);
  const pricingModel = product.pricingModel === "per_song" ? "per_song" : "flat";
  const firstTier = product.volumeTiers?.[0];

  return {
    _picked: null,
    _legacyAgreementLink: agreement.requiresLegacyLinkReplacement,
    name: product.name,
    tagline: decoded.tagline,
    type: kindToPresetType(product.kind),
    price:
      pricingModel === "per_song" && firstTier
        ? firstTier.pricePerUnitCents / 100
        : product.priceCents / 100,
    currency,
    includesSessions: product.durationMin > 0,
    sessions: product.sessionCount === 0 ? 1 : product.sessionCount,
    unlimitedSessions: product.durationMin > 0 && product.sessionCount === 0,
    payment: seedPaymentSelection(product.paymentPlans),
    includes: [...product.deliverables],
    duration:
      typeof product.durationMin === "number" && product.durationMin > 0
        ? `${String(product.durationMin)} min`
        : "",
    revisions: decoded.revisions,
    unlimitedRevisions: decoded.unlimitedRevisions,
    agreementMode: agreement.agreementMode,
    agreementText: agreement.agreementText,
    royalty: royaltyTermsToDraft(product.royaltyTerms),
    pricingModel,
    volumeTiers: product.volumeTiers ?? [],
  };
}

function typeLabel(type: PresetType): string {
  if (type === "production") return "Production";
  if (type === "mix") return "Mix";
  if (type === "master") return "Master";
  return "Custom";
}

export function ProductEditor({
  open,
  onOpenChange,
  product,
  defaultCurrency,
  taxMode,
  taxRatePct,
  producerName = "Your studio",
  previewPlacement = "focal",
  onCreated,
  onSubmitted,
  onDiscardDraft,
  persistedDraft,
  onPersistDraft,
}: ProductEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const mode = product ? "edit" : "new";
  const steps = mode === "edit" ? EDIT_STEPS : NEW_STEPS;

  const [draft, setDraft] = useState<Draft>(() =>
    product ? seedDraftFromProduct(product, defaultCurrency) : emptyDraft(defaultCurrency),
  );
  const [currentStep, setCurrentStep] = useState<StepId>(product ? "details" : "type");
  const [returnToReview, setReturnToReview] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [savingAction, setSavingAction] = useState<"publish" | "hidden" | "edit" | null>(null);
  const [rightsTouched, setRightsTouched] = useState({
    master: false,
    composition: false,
    notes: false,
    agreement: false,
  });
  const initializedEditorRef = useRef<string | null>(null);
  const latestPersistedDraftRef = useRef<ProducerStoreProductDraft | null>(null);

  useEffect(() => {
    if (!open) {
      initializedEditorRef.current = null;
      latestPersistedDraftRef.current = null;
      return;
    }
    const productId = product?.id ?? null;
    const editorKey = `${mode}:${productId ?? "new"}`;
    if (initializedEditorRef.current === editorKey) return;
    initializedEditorRef.current = editorKey;
    const restored =
      persistedDraft?.mode === mode && persistedDraft.productId === productId
        ? persistedDraft
        : null;
    const nextDraft = restored?.draft
      ? normalizeDraft(restored.draft)
      : product
        ? seedDraftFromProduct(product, defaultCurrency)
        : emptyDraft(defaultCurrency);
    const fallbackStep: StepId = product ? "details" : "type";
    const nextStep =
      restored && steps.includes(restored.currentStep) ? restored.currentStep : fallbackStep;
    setDraft(nextDraft);
    setCurrentStep(nextStep);
    setReturnToReview(false);
    setRightsTouched({
      master: false,
      composition: false,
      notes: false,
      agreement: false,
    });
    const nextRecord: ProducerStoreProductDraft = {
      open: true,
      mode,
      productId,
      currentStep: nextStep,
      draft: nextDraft,
    };
    latestPersistedDraftRef.current = nextRecord;
    setDraftSaved(onPersistDraft(nextRecord));
  }, [defaultCurrency, mode, onPersistDraft, open, persistedDraft, product, steps]);

  useEffect(() => {
    if (!open || initializedEditorRef.current === null) return;
    const nextRecord: ProducerStoreProductDraft = {
      open: true,
      mode,
      productId: product?.id ?? null,
      currentStep,
      draft,
    };
    latestPersistedDraftRef.current = nextRecord;
    setDraftSaved(false);
    const timeout = window.setTimeout(() => {
      const latest = latestPersistedDraftRef.current;
      if (latest && onPersistDraft(latest)) setDraftSaved(true);
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [currentStep, draft, mode, onPersistDraft, open, product?.id]);

  useEffect(() => {
    if (!open) return;
    const flush = () => {
      const next = latestPersistedDraftRef.current;
      if (next) onPersistDraft(next);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [onPersistDraft, open]);

  function handleEditorOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      const latest = latestPersistedDraftRef.current;
      if (latest) onPersistDraft(latest);
      latestPersistedDraftRef.current = null;
    }
    onOpenChange(nextOpen);
  }

  function handleSuccessfulSubmit() {
    latestPersistedDraftRef.current = null;
    onSubmitted();
    onOpenChange(false);
  }

  function handleDiscardDraft() {
    latestPersistedDraftRef.current = null;
    setDraftSaved(false);
    if (onDiscardDraft) onDiscardDraft();
    else onSubmitted();
    onOpenChange(false);
  }

  function onPickPreset(id: PresetId) {
    const preset = getPreset(id);
    if (!preset) return;
    setDraft((current) => ({
      ...current,
      _picked: id,
      type: preset.preset.type,
      name: current.name.trim() ? current.name : preset.defaultName,
      price: preset.preset.price,
      includesSessions: preset.preset.includesSessions,
      sessions: preset.preset.sessions,
      unlimitedSessions: preset.preset.unlimitedSessions,
      payment: seedPaymentSelection(plansForPreset(preset.preset.paymentPlan)),
      includes: [...preset.baseline],
      duration: preset.preset.duration === "multi-session" ? "60 min" : preset.preset.duration,
      revisions: preset.preset.revisions,
    }));
  }

  const currentStepIndex = Math.max(0, steps.indexOf(currentStep));
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;
  const priceError = productCashPriceError(draft);
  const validPrice = priceError === null;
  const validMonthly =
    !draft.payment.monthly ||
    (Number.isInteger(draft.payment.monthlyInstallments) &&
      draft.payment.monthlyInstallments >= 2 &&
      draft.payment.monthlyInstallments <= 12);
  const validPayment = validMonthly && hasPaymentOption(draft.payment);
  const paymentError = !hasPaymentOption(draft.payment)
    ? "Choose at least one payment option."
    : !validMonthly
      ? "Monthly payments must be between 2 and 12."
      : paymentPlanFeasibilityError(draft);
  const royaltyErrors = validateRoyaltyDraft(draft.royalty, mode === "new");
  const agreementError =
    draft._legacyAgreementLink && (draft.agreementMode !== "text" || !draft.agreementText.trim())
      ? "Replace the old agreement link with the exact terms before saving."
      : validateAgreementDraft(draft.agreementMode, draft.agreementText);
  const visibleRoyaltyErrors = {
    ...(rightsTouched.master && royaltyErrors.master ? { master: royaltyErrors.master } : {}),
    ...(rightsTouched.composition && royaltyErrors.composition
      ? { composition: royaltyErrors.composition }
      : {}),
    ...(rightsTouched.notes && royaltyErrors.notes ? { notes: royaltyErrors.notes } : {}),
  };
  const visibleAgreementError =
    rightsTouched.agreement || draft._legacyAgreementLink ? agreementError : null;
  const validRights = Object.keys(royaltyErrors).length === 0 && agreementError === null;
  const validDelivery =
    !draft.includesSessions ||
    (/^\d+\s*min$/i.test(draft.duration) &&
      (draft.unlimitedSessions ||
        (Number.isInteger(draft.sessions) && draft.sessions >= 1 && draft.sessions <= 99)));
  const validDetails =
    draft.name.trim().length > 0 &&
    draft.name.trim().length <= 200 &&
    productTaglineError(draft.tagline) === null &&
    draft.includes.length <= 10 &&
    draft.includes.every((item) => item.trim().length > 0 && item.trim().length <= 100);
  const validType = mode === "edit" || draft._picked !== null;
  const allValid =
    validType && validDetails && validPrice && validPayment && validDelivery && validRights;

  const canContinue = (() => {
    if (currentStep === "type") return validType;
    if (currentStep === "details") return validDetails;
    if (currentStep === "price") return validPrice;
    if (currentStep === "payment") return validPayment;
    if (currentStep === "delivery") return validDelivery;
    if (currentStep === "rights") return validRights;
    return allValid;
  })();

  function goBack() {
    if (isFirstStep) return;
    setReturnToReview(false);
    setCurrentStep(steps[currentStepIndex - 1] ?? currentStep);
  }

  function goNext() {
    if (isLastStep || !canContinue) return;
    if (returnToReview) {
      setReturnToReview(false);
      setCurrentStep("review");
      return;
    }
    setCurrentStep(steps[currentStepIndex + 1] ?? currentStep);
  }

  function editFromReview(step: ReviewEditStep) {
    setReturnToReview(true);
    setCurrentStep(step);
  }

  function save(active: boolean) {
    if (!allValid || currentStep !== "review") {
      if (!validDetails) setCurrentStep("details");
      else if (!validPrice) setCurrentStep("price");
      else if (!validPayment) setCurrentStep("payment");
      else if (!validDelivery) setCurrentStep("delivery");
      else if (!validRights) setCurrentStep("rights");
      return;
    }
    if (!online) {
      toast("Reconnect to save this product.", "error");
      return;
    }

    setSavingAction(product ? "edit" : active ? "publish" : "hidden");
    startTransition(async () => {
      try {
        if (product) {
          const payload = buildPackageUpdatePayload(draft, product.kind);
          const result = await updatePackage({ id: product.id, ...payload });
          if (!result.ok) {
            toast(result.error, "error");
            return;
          }
          toast(`${draft.name.trim()} saved.`, "success");
        } else {
          const payload = buildPackagePayload(draft);
          const result = await createPackage({ ...payload, active });
          if (!result.ok) {
            toast(result.error, "error");
            return;
          }
          onCreated?.(result.data.id);
          toast(
            active ? `${draft.name.trim()} published.` : `${draft.name.trim()} saved hidden.`,
            "success",
          );
        }
        handleSuccessfulSubmit();
        router.refresh();
      } catch {
        toast("Could not save this product. Please try again.", "error");
      } finally {
        setSavingAction(null);
      }
    });
  }

  const basePriceCents = Math.round(draft.price * 100);
  const previewPriceCents = applyTaxToCents(basePriceCents, taxMode, taxRatePct);
  const reviewPlans = validMonthly ? buildPaymentPlans(draft.payment) : [];
  const reviewRoyaltyTerms = royaltyDraftToTerms(draft.royalty);

  return (
    <EditorShell
      open={open}
      onOpenChange={handleEditorOpenChange}
      mode={mode}
      {...(product ? { productName: product.name } : {})}
      productActive={product?.active ?? false}
      steps={steps}
      current={currentStep}
      title={STEP_TITLES[currentStep]}
      subtitle={STEP_SUBTITLES[currentStep]}
      canContinue={canContinue}
      onBack={goBack}
      onContinue={goNext}
      onSave={() => {
        save(product?.active ?? false);
      }}
      onPublish={() => {
        save(true);
      }}
      onSaveHidden={() => {
        save(false);
      }}
      onDiscard={handleDiscardDraft}
      isFirstStep={isFirstStep}
      isLastStep={isLastStep}
      pending={pending}
      {...(savingAction ? { pendingAction: savingAction } : {})}
      draftSaved={draftSaved}
    >
      <div key={currentStep} className="sk-step-enter">
        {currentStep === "type" ? <TypeStep picked={draft._picked} onPick={onPickPreset} /> : null}

        {currentStep === "details" ? (
          <IncludesStep
            pickedId={draft._picked}
            name={draft.name}
            onNameChange={(name) => {
              setDraft((current) => ({ ...current, name }));
            }}
            tagline={draft.tagline}
            onTaglineChange={(tagline) => {
              setDraft((current) => ({ ...current, tagline }));
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
            pricingModel={draft.pricingModel}
            volumeTiers={draft.volumeTiers}
            taxMode={taxMode}
            taxRatePct={taxRatePct}
            showTaxSummary={true}
            priceError={priceError}
            onChange={(patch) => {
              setDraft((current) => ({ ...current, ...patch }));
            }}
          />
        ) : null}

        {currentStep === "payment" ? (
          <PaymentStep
            selection={draft.payment}
            previewTotalCents={previewPriceCents}
            currency={draft.currency}
            pricingModel={draft.pricingModel}
            {...(paymentError ? { error: paymentError } : {})}
            onChange={(payment) => {
              setDraft((current) => ({ ...current, payment }));
            }}
          />
        ) : null}

        {currentStep === "delivery" ? (
          <LogisticsStep
            includesSessions={draft.includesSessions}
            sessions={draft.sessions}
            unlimitedSessions={draft.unlimitedSessions}
            pricingModel={draft.pricingModel}
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
            agreementText={draft.agreementText}
            errors={visibleRoyaltyErrors}
            {...(visibleAgreementError ? { agreementError: visibleAgreementError } : {})}
            legacyUnspecified={mode === "edit" && product?.royaltyTerms == null}
            onRoyaltyChange={(royalty) => {
              setRightsTouched((current) => ({
                master:
                  current.master ||
                  royalty.masterMode !== draft.royalty.masterMode ||
                  royalty.masterPercentage !== draft.royalty.masterPercentage,
                composition:
                  current.composition ||
                  royalty.compositionMode !== draft.royalty.compositionMode ||
                  royalty.compositionPercentage !== draft.royalty.compositionPercentage ||
                  royalty.compositionRole !== draft.royalty.compositionRole ||
                  royalty.collectingSociety !== draft.royalty.collectingSociety,
                notes: current.notes || royalty.notes !== draft.royalty.notes,
                agreement: current.agreement,
              }));
              setDraft((current) => ({ ...current, royalty }));
            }}
            onAgreementChange={(patch) => {
              setRightsTouched((current) => ({
                ...current,
                agreement: true,
              }));
              setDraft((current) => ({ ...current, ...patch }));
            }}
          />
        ) : null}

        {currentStep === "review" ? (
          <ReviewStep
            name={draft.name.trim()}
            tagline={draft.tagline.trim()}
            typeLabel={typeLabel(draft.type)}
            showTypeEdit={mode === "new"}
            includes={draft.includes}
            pricingModel={draft.pricingModel}
            volumeTiers={draft.volumeTiers}
            priceCents={basePriceCents}
            artistPaysCents={previewPriceCents}
            taxNote={taxModeFootnote(taxMode, taxRatePct)}
            currency={draft.currency}
            includesSessions={draft.includesSessions}
            sessions={draft.sessions}
            unlimitedSessions={draft.unlimitedSessions}
            paymentPlans={reviewPlans}
            duration={draft.duration}
            revisions={draft.revisions}
            unlimitedRevisions={draft.unlimitedRevisions}
            royaltyTerms={reviewRoyaltyTerms}
            agreementMode={draft.agreementMode}
            agreementText={draft.agreementText}
            producerName={producerName}
            taxMode={taxMode}
            taxRatePct={taxRatePct}
            previewPlacement={previewPlacement}
            onEdit={editFromReview}
          />
        ) : null}
      </div>
    </EditorShell>
  );
}
