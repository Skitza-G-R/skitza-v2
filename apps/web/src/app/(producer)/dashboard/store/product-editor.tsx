"use client";

import type { PaymentPlan } from "@skitza/db";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  cancelAgreementPdfUpload,
  createPackage,
  prepareAgreementPdfUpload,
  updatePackage,
} from "~/app/(producer)/dashboard/booking/actions";
import { updateProducer } from "~/app/(producer)/dashboard/settings/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import type { SaveStatus } from "~/components/ui/save-indicator";
import { useToast } from "~/components/ui/toast";
import type {
  ProducerStoreDraftStep,
  ProducerStoreProductDraft,
} from "~/lib/runtime-state/runtime-state";
import { applyTaxToCents, taxModeFootnote } from "~/lib/tax-mode";
import { agreementPdfFileError } from "~/lib/agreement-pdf";

import { buildPackagePayload, buildPackageUpdatePayload } from "./build-package-payload";
import { decodeDescription } from "./description-encoding";
import { IncludesStep } from "./editor-steps/includes-step";
import { LogisticsStep } from "./editor-steps/logistics-step";
import { OnboardingTaxStep } from "./editor-steps/onboarding-tax-step";
import { PaymentStep } from "./editor-steps/payment-step";
import { PricingStep } from "./editor-steps/pricing-step";
import { ReviewStep, type ReviewEditStep } from "./editor-steps/review-step";
import { RightsAgreementStep } from "./editor-steps/rights-agreement-step";
import { TypeStep } from "./editor-steps/type-step";
import { EditorShell } from "./editor-shell";
import { kindToTile } from "./kind-to-tile";
import {
  buildPaymentPlans,
  type AgreementPdfDraft,
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
const ONBOARDING_NEW_STEPS: readonly StepId[] = [
  "type",
  "details",
  "tax",
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
const ONBOARDING_EDIT_STEPS: readonly StepId[] = [
  "details",
  "tax",
  "price",
  "payment",
  "delivery",
  "rights",
  "review",
];

const STEP_TITLES: Record<StepId, string> = {
  type: "What are you offering?",
  details: "Product details",
  tax: "How should tax work?",
  price: "Price",
  payment: "Payment options",
  delivery: "Delivery",
  rights: "Rights & agreement",
  review: "Review your product",
};

const STEP_SUBTITLES: Record<StepId, string> = {
  type: "Pick the closest match. We'll prefill the practical details.",
  details: "Add the title, short description, and deliverables artists will see.",
  tax: "Choose once for your studio. Every price will use this setting.",
  price: "Choose a pricing model and see the artist's total.",
  payment: "Choose one or more. The artist picks after approval.",
  delivery: "Choose whether artists can book time, then set delivery details.",
  rights: "Define headline master and composition terms, then add an optional agreement.",
  review: "Check every term before this product is created or updated.",
};

type PersistedDraft = ProducerStoreProductDraft["draft"];
type Draft = Omit<
  PersistedDraft,
  "includesSessions" | "bookingEnabled" | "taxMode" | "taxRatePct" | "agreementPdf"
> & {
  includesSessions: boolean;
  bookingEnabled: boolean;
  taxMode: import("~/lib/tax-mode").TaxMode | null;
  taxRatePct: number;
  agreementPdf: AgreementPdfDraft | null;
};

interface ProductEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Store uses a dialog; onboarding keeps the same editor inside its wizard chrome. */
  presentation?: "dialog" | "embedded";
  product: StoreProduct | null;
  defaultCurrency: Currency;
  taxMode: import("~/lib/tax-mode").TaxMode;
  taxRatePct: number;
  producerName?: string;
  previewPlacement?: "focal" | "secondary";
  onCreated?: (id: string) => void;
  onSubmitted: () => void;
  onSubmittedResult?: (result: { includesSessions: boolean; bookingEnabled: boolean }) => void;
  onDiscardDraft?: () => void;
  persistedDraft: ProducerStoreProductDraft | null;
  onPersistDraft: (draft: ProducerStoreProductDraft) => boolean;
  /** Onboarding always creates hidden, then publishes at its final review. */
  newProductFlow?: "store" | "onboarding";
  /** Development-only visual walkthrough: preserve editor behavior without writes. */
  previewMode?: boolean;
}

const VALID_CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP", "ILS"];

function plansForPreset(choice: PaymentPlanChoice): PaymentPlan[] {
  if (choice === "full") return [{ kind: "full" }];
  if (choice === "split") return [{ kind: "split_50_50" }];
  return [{ kind: "monthly", installments: 4 }];
}

function emptyDraft(
  currency: Currency,
  taxMode: import("~/lib/tax-mode").TaxMode,
  taxRatePct: number,
  requireTaxChoice: boolean,
): Draft {
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
    bookingEnabled: false,
    taxMode: requireTaxChoice ? null : taxMode,
    taxRatePct,
    payment: seedPaymentSelection([{ kind: "full" }]),
    includes: [],
    duration: "60 min",
    revisions: 0,
    unlimitedRevisions: false,
    agreementMode: "none",
    agreementText: "",
    agreementPdf: null,
    royalty: royaltyTermsToDraft(null),
    pricingModel: "flat",
    volumeTiers: [],
  };
}

function normalizeDraft(
  draft: PersistedDraft,
  fallbackTaxMode: import("~/lib/tax-mode").TaxMode,
  fallbackTaxRatePct: number,
  preserveOnboardingTaxChoice: boolean,
): Draft {
  const includesSessions =
    draft.includesSessions ?? draft.bookingEnabled ?? /^\d+\s*min$/i.test(draft.duration);
  return {
    ...draft,
    includesSessions,
    bookingEnabled: includesSessions,
    taxMode: preserveOnboardingTaxChoice ? (draft.taxMode ?? null) : fallbackTaxMode,
    taxRatePct: preserveOnboardingTaxChoice
      ? (draft.taxRatePct ?? fallbackTaxRatePct)
      : fallbackTaxRatePct,
    // Upload capabilities are intentionally never persisted. A staged file
    // restored after a reload has no usable token, so require a fresh upload.
    agreementPdf: draft.agreementPdf?.documentId ? draft.agreementPdf : null,
  };
}

function draftForPersistence(draft: Draft, onboarding: boolean): PersistedDraft {
  if (onboarding) return draft;
  const { taxMode: currentTaxMode, taxRatePct: currentTaxRatePct, ...persisted } = draft;
  void currentTaxMode;
  void currentTaxRatePct;
  return persisted;
}

function kindToPresetType(kind: string): PresetType {
  return kindToTile(kind);
}

function seedDraftFromProduct(
  product: StoreProduct,
  defaultCurrency: Currency,
  taxMode: import("~/lib/tax-mode").TaxMode,
  taxRatePct: number,
): Draft {
  const decoded = decodeDescription(product.description);
  const currency = (VALID_CURRENCIES as readonly string[]).includes(product.currency)
    ? (product.currency as Currency)
    : defaultCurrency;
  const dedicatedAgreement = product.agreementText ?? decoded.contractText;
  const agreementPdf: AgreementPdfDraft | null = product.agreementPdf
    ? {
        documentId: product.agreementPdf.documentId,
        originalFileName: product.agreementPdf.originalFileName,
        sizeBytes: product.agreementPdf.sizeBytes,
      }
    : null;
  const agreement = seedStoreAgreementDraft(
    dedicatedAgreement,
    product.legacyAgreementLinkPresent ? "legacy-external-link" : null,
    agreementPdf,
  );
  const pricingModel = product.pricingModel === "per_song" ? "per_song" : "flat";
  const firstTier = product.volumeTiers?.[0];
  const includesSessions = product.bookingEnabled;

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
    includesSessions,
    sessions: product.sessionCount === 0 ? 1 : product.sessionCount,
    unlimitedSessions: includesSessions && product.sessionCount === 0,
    bookingEnabled: includesSessions,
    taxMode,
    taxRatePct,
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
    agreementPdf: agreement.agreementPdf,
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

async function uploadAgreementPdfBytes(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  });
  if (!response.ok) throw new Error("The PDF upload did not finish. Try again.");
}

export function ProductEditor({
  open,
  onOpenChange,
  presentation = "dialog",
  product,
  defaultCurrency,
  taxMode,
  taxRatePct,
  producerName = "Your studio",
  previewPlacement = "focal",
  onCreated,
  onSubmitted,
  onSubmittedResult,
  onDiscardDraft,
  persistedDraft,
  onPersistDraft,
  newProductFlow = "store",
  previewMode = false,
}: ProductEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const mode = product ? "edit" : "new";
  const steps =
    newProductFlow === "onboarding"
      ? mode === "edit"
        ? ONBOARDING_EDIT_STEPS
        : ONBOARDING_NEW_STEPS
      : mode === "edit"
        ? EDIT_STEPS
        : NEW_STEPS;

  const [draft, setDraft] = useState<Draft>(() =>
    product
      ? seedDraftFromProduct(product, defaultCurrency, taxMode, taxRatePct)
      : emptyDraft(defaultCurrency, taxMode, taxRatePct, newProductFlow === "onboarding"),
  );
  const [currentStep, setCurrentStep] = useState<StepId>(product ? "details" : "type");
  const [returnToReview, setReturnToReview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savingAction, setSavingAction] = useState<"publish" | "hidden" | "edit" | null>(null);
  const [agreementPdfUploadToken, setAgreementPdfUploadToken] = useState<string | null>(null);
  const [pdfUploadPending, setPdfUploadPending] = useState(false);
  const [taxSaveError, setTaxSaveError] = useState<string | null>(null);
  const [rightsTouched, setRightsTouched] = useState({
    master: false,
    composition: false,
    notes: false,
    agreement: false,
  });
  const initializedEditorRef = useRef<string | null>(null);
  const latestPersistedDraftRef = useRef<ProducerStoreProductDraft | null>(null);
  const saveStatusRequestRef = useRef(0);

  useEffect(() => {
    if (!open) {
      initializedEditorRef.current = null;
      latestPersistedDraftRef.current = null;
      saveStatusRequestRef.current += 1;
      setSaveStatus("idle");
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
      ? normalizeDraft(restored.draft, taxMode, taxRatePct, newProductFlow === "onboarding")
      : product
        ? seedDraftFromProduct(product, defaultCurrency, taxMode, taxRatePct)
        : emptyDraft(defaultCurrency, taxMode, taxRatePct, newProductFlow === "onboarding");
    const fallbackStep: StepId = product ? "details" : "type";
    const nextStep =
      restored && steps.includes(restored.currentStep) ? restored.currentStep : fallbackStep;
    setDraft(nextDraft);
    setCurrentStep(nextStep);
    setReturnToReview(false);
    setAgreementPdfUploadToken(null);
    setPdfUploadPending(false);
    setTaxSaveError(null);
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
      draft: draftForPersistence(nextDraft, newProductFlow === "onboarding"),
    };
    latestPersistedDraftRef.current = nextRecord;
    const statusRequest = ++saveStatusRequestRef.current;
    const persisted = onPersistDraft(nextRecord);
    if (saveStatusRequestRef.current === statusRequest) {
      setSaveStatus(persisted ? "saved" : "error");
    }
  }, [
    defaultCurrency,
    mode,
    newProductFlow,
    onPersistDraft,
    open,
    persistedDraft,
    product,
    steps,
    taxMode,
    taxRatePct,
  ]);

  useEffect(() => {
    if (!open || initializedEditorRef.current === null) return;
    const nextRecord: ProducerStoreProductDraft = {
      open: true,
      mode,
      productId: product?.id ?? null,
      currentStep,
      draft: draftForPersistence(draft, newProductFlow === "onboarding"),
    };
    latestPersistedDraftRef.current = nextRecord;
    const statusRequest = ++saveStatusRequestRef.current;
    setSaveStatus("saving");
    const timeout = window.setTimeout(() => {
      const latest = latestPersistedDraftRef.current;
      const persisted = Boolean(latest && onPersistDraft(latest));
      if (saveStatusRequestRef.current === statusRequest) {
        setSaveStatus(persisted ? "saved" : "error");
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [currentStep, draft, mode, newProductFlow, onPersistDraft, open, product?.id]);

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
    if (!nextOpen && pending) return;
    if (!nextOpen) {
      const latest = latestPersistedDraftRef.current;
      const safeLatest =
        latest?.draft.agreementPdf?.documentId === null
          ? {
              ...latest,
              draft: { ...latest.draft, agreementPdf: null },
            }
          : latest;
      if (agreementPdfUploadToken) {
        void cancelAgreementPdfUpload({ uploadToken: agreementPdfUploadToken });
        setAgreementPdfUploadToken(null);
      }
      if (safeLatest) onPersistDraft(safeLatest);
      latestPersistedDraftRef.current = null;
      saveStatusRequestRef.current += 1;
      setSaveStatus("idle");
    }
    onOpenChange(nextOpen);
  }

  function handleSuccessfulSubmit() {
    latestPersistedDraftRef.current = null;
    setAgreementPdfUploadToken(null);
    onSubmitted();
    onSubmittedResult?.({
      includesSessions: draft.includesSessions,
      bookingEnabled: draft.bookingEnabled,
    });
    onOpenChange(false);
  }

  function handleDiscardDraft() {
    if (agreementPdfUploadToken) {
      void cancelAgreementPdfUpload({ uploadToken: agreementPdfUploadToken });
    }
    setAgreementPdfUploadToken(null);
    latestPersistedDraftRef.current = null;
    saveStatusRequestRef.current += 1;
    setSaveStatus("idle");
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
      bookingEnabled: preset.preset.includesSessions,
      payment: seedPaymentSelection(plansForPreset(preset.preset.paymentPlan)),
      includes: [...preset.baseline],
      duration: preset.preset.duration === "multi-session" ? "60 min" : preset.preset.duration,
      revisions: preset.preset.revisions,
    }));
  }

  async function handleAgreementPdfSelect(file: File) {
    const fileError = agreementPdfFileError({
      originalFileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (fileError) {
      setRightsTouched((current) => ({ ...current, agreement: true }));
      toast(fileError, "error");
      return;
    }
    if (!online) {
      toast("Reconnect to upload the agreement PDF.", "error");
      return;
    }
    const previousToken = agreementPdfUploadToken;
    setPdfUploadPending(true);
    try {
      const prepared = await prepareAgreementPdfUpload({
        originalFileName: file.name,
        contentType: "application/pdf",
        sizeBytes: file.size,
      });
      if (!prepared.ok) {
        toast(prepared.error, "error");
        return;
      }
      try {
        await uploadAgreementPdfBytes(prepared.data.uploadUrl, file);
      } catch (error) {
        await cancelAgreementPdfUpload({ uploadToken: prepared.data.uploadToken });
        throw error;
      }
      if (previousToken) {
        void cancelAgreementPdfUpload({ uploadToken: previousToken });
      }
      setAgreementPdfUploadToken(prepared.data.uploadToken);
      setRightsTouched((current) => ({ ...current, agreement: true }));
      setDraft((current) => ({
        ...current,
        _legacyAgreementLink: false,
        agreementMode: "pdf",
        agreementPdf: {
          documentId: null,
          originalFileName: file.name,
          sizeBytes: file.size,
        },
      }));
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not upload the PDF. Try again.",
        "error",
      );
    } finally {
      setPdfUploadPending(false);
    }
  }

  function removeAgreementPdf() {
    if (agreementPdfUploadToken) {
      void cancelAgreementPdfUpload({ uploadToken: agreementPdfUploadToken });
    }
    setAgreementPdfUploadToken(null);
    setDraft((current) => ({ ...current, agreementMode: "none", agreementPdf: null }));
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
      : validateAgreementDraft(draft.agreementMode, draft.agreementText, draft.agreementPdf);
  const visibleRoyaltyErrors = {
    ...(rightsTouched.master && royaltyErrors.master ? { master: royaltyErrors.master } : {}),
    ...(rightsTouched.composition && royaltyErrors.composition
      ? { composition: royaltyErrors.composition }
      : {}),
    ...(rightsTouched.notes && royaltyErrors.notes ? { notes: royaltyErrors.notes } : {}),
  };
  const visibleAgreementError =
    rightsTouched.agreement || draft._legacyAgreementLink ? agreementError : null;
  const validRights =
    Object.keys(royaltyErrors).length === 0 && agreementError === null && !pdfUploadPending;
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
  const validTax =
    newProductFlow !== "onboarding" ||
    (draft.taxMode !== null &&
      Number.isSafeInteger(draft.taxRatePct) &&
      draft.taxRatePct >= 0 &&
      draft.taxRatePct <= 100);
  const allValid =
    validType &&
    validDetails &&
    validTax &&
    validPrice &&
    validPayment &&
    validDelivery &&
    validRights;

  const canContinue = (() => {
    if (currentStep === "type") return validType;
    if (currentStep === "details") return validDetails;
    if (currentStep === "tax") return validTax;
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

  function advanceToNextStep() {
    if (isLastStep || !canContinue) return;
    if (returnToReview) {
      setReturnToReview(false);
      setCurrentStep("review");
      return;
    }
    setCurrentStep(steps[currentStepIndex + 1] ?? currentStep);
  }

  function goNext() {
    if (currentStep !== "tax" || newProductFlow !== "onboarding") {
      advanceToNextStep();
      return;
    }
    if (!validTax || draft.taxMode === null) return;
    if (previewMode) {
      advanceToNextStep();
      return;
    }
    if (!online) {
      setTaxSaveError("Reconnect to save your tax setup.");
      return;
    }
    setTaxSaveError(null);
    startTransition(async () => {
      const result = await updateProducer({
        taxMode: draft.taxMode ?? "tax_free",
        taxRatePct: draft.taxRatePct,
      });
      if (!result.ok) {
        setTaxSaveError(result.error);
        return;
      }
      advanceToNextStep();
      router.refresh();
    });
  }

  function editFromReview(step: ReviewEditStep) {
    setReturnToReview(true);
    setCurrentStep(step);
  }

  function save(active: boolean) {
    if (!allValid || currentStep !== "review") {
      if (!validDetails) setCurrentStep("details");
      else if (!validTax) setCurrentStep("tax");
      else if (!validPrice) setCurrentStep("price");
      else if (!validPayment) setCurrentStep("payment");
      else if (!validDelivery) setCurrentStep("delivery");
      else if (!validRights) setCurrentStep("rights");
      return;
    }
    if (previewMode) {
      const previewId = product?.id ?? "onboarding-preview-product";
      if (!product) {
        onCreated?.(previewId);
      }
      handleSuccessfulSubmit();
      return;
    }
    if (!online) {
      saveStatusRequestRef.current += 1;
      setSaveStatus("idle");
      toast("Reconnect to save this product.", "error");
      return;
    }

    const statusRequest = ++saveStatusRequestRef.current;
    setSaveStatus("saving");
    setSavingAction(product ? "edit" : active ? "publish" : "hidden");
    startTransition(async () => {
      try {
        if (product) {
          const payload = buildPackageUpdatePayload(draft, product.kind, agreementPdfUploadToken);
          const result = await updatePackage({ id: product.id, ...payload });
          if (!result.ok) {
            if (saveStatusRequestRef.current === statusRequest) setSaveStatus("idle");
            toast(result.error, "error");
            return;
          }
        } else {
          const payload = buildPackagePayload(draft, undefined, agreementPdfUploadToken);
          const result = await createPackage({ ...payload, active });
          if (!result.ok) {
            if (saveStatusRequestRef.current === statusRequest) setSaveStatus("idle");
            toast(result.error, "error");
            return;
          }
          onCreated?.(result.data.id);
          if (active) toast(`${draft.name.trim()} published.`, "success");
        }
        if (saveStatusRequestRef.current === statusRequest) setSaveStatus("saved");
        handleSuccessfulSubmit();
        router.refresh();
      } catch {
        if (saveStatusRequestRef.current === statusRequest) setSaveStatus("idle");
        toast("Could not save this product. Please try again.", "error");
      } finally {
        setSavingAction(null);
      }
    });
  }

  const basePriceCents = Math.round(draft.price * 100);
  const effectiveTaxMode = draft.taxMode ?? taxMode;
  const effectiveTaxRatePct = draft.taxRatePct;
  const previewPriceCents = applyTaxToCents(basePriceCents, effectiveTaxMode, effectiveTaxRatePct);
  const reviewPlans = validMonthly ? buildPaymentPlans(draft.payment) : [];
  const reviewRoyaltyTerms = royaltyDraftToTerms(draft.royalty);

  return (
    <EditorShell
      open={open}
      onOpenChange={handleEditorOpenChange}
      presentation={presentation}
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
      saveStatus={saveStatus}
      newProductFlow={newProductFlow}
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

        {currentStep === "tax" ? (
          <OnboardingTaxStep
            value={draft.taxMode}
            taxRatePct={draft.taxRatePct}
            currency={draft.currency}
            error={taxSaveError}
            onChange={(patch) => {
              setTaxSaveError(null);
              setDraft((current) => ({ ...current, ...patch }));
            }}
          />
        ) : null}

        {currentStep === "price" ? (
          <PricingStep
            price={draft.price}
            currency={draft.currency}
            pricingModel={draft.pricingModel}
            volumeTiers={draft.volumeTiers}
            taxMode={effectiveTaxMode}
            taxRatePct={effectiveTaxRatePct}
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
            agreementPdf={draft.agreementPdf}
            pdfUploadPending={pdfUploadPending}
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
              if (patch.agreementMode && patch.agreementMode !== "pdf" && agreementPdfUploadToken) {
                void cancelAgreementPdfUpload({ uploadToken: agreementPdfUploadToken });
                setAgreementPdfUploadToken(null);
                setDraft((current) => ({
                  ...current,
                  ...patch,
                  agreementPdf: current.agreementPdf?.documentId ? current.agreementPdf : null,
                }));
                return;
              }
              setDraft((current) => ({ ...current, ...patch }));
            }}
            onAgreementPdfSelect={(file) => {
              void handleAgreementPdfSelect(file);
            }}
            onAgreementPdfRemove={removeAgreementPdf}
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
            taxNote={taxModeFootnote(effectiveTaxMode, effectiveTaxRatePct)}
            currency={draft.currency}
            includesSessions={draft.includesSessions}
            sessions={draft.sessions}
            unlimitedSessions={draft.unlimitedSessions}
            bookingEnabled={draft.bookingEnabled}
            paymentPlans={reviewPlans}
            duration={draft.duration}
            revisions={draft.revisions}
            unlimitedRevisions={draft.unlimitedRevisions}
            royaltyTerms={reviewRoyaltyTerms}
            agreementMode={draft.agreementMode}
            agreementText={draft.agreementText}
            agreementPdf={draft.agreementPdf}
            producerName={producerName}
            taxMode={effectiveTaxMode}
            taxRatePct={effectiveTaxRatePct}
            previewPlacement={previewPlacement}
            onEdit={editFromReview}
          />
        ) : null}
      </div>
    </EditorShell>
  );
}
