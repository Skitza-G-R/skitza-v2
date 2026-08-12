"use client";

import { Pencil, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { EditorShell } from "~/app/(producer)/dashboard/store/editor-shell";
import { TypeStep } from "~/app/(producer)/dashboard/store/editor-steps/type-step";
import {
  loadPrivateOfferProjectOptionsAction,
  sendPrivateOfferAction,
  type PrivateOfferProjectOption,
  updatePrivateOfferAction,
} from "~/app/(producer)/dashboard/store/private-offer-actions";
import { getPreset, type PresetId } from "~/app/(producer)/dashboard/store/type-presets";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useProducerPrivateOfferDraft } from "~/components/runtime-state/use-runtime-state";
import type { SaveStatus } from "~/components/ui/save-indicator";
import { useToast } from "~/components/ui/toast";
import type { ProducerPrivateOfferDraft } from "~/lib/runtime-state/runtime-state";
import type { TaxMode } from "~/lib/tax-mode";
import type { PrivateOfferInput } from "~/server/domain/private-offers/service";

import {
  parsePrivateOfferComposerDraftJson,
  privateOfferRecipientEmail,
  seedPrivateOfferDraft,
  validatePrivateOfferDraft,
  validatePrivateOfferReviewDraft,
  validatePrivateOfferStep,
  validatePrivateOfferTemplateQuantity,
  type PrivateOfferComposerDraft,
  type PrivateOfferCurrency,
  type PrivateOfferDraftError,
  type PrivateOfferDraftField,
  type PrivateOfferReviewDraft,
} from "./private-offer-editor-model";
import {
  PrivateOfferDeliveryStep,
  PrivateOfferDetailsStep,
  PrivateOfferPaymentStep,
  PrivateOfferPriceStep,
  PrivateOfferQuickStep,
  PrivateOfferRightsStep,
  RecipientProjectFields,
} from "./private-offer-editor-steps";
import { PrivateOfferReview, type PrivateOfferReviewEditStep } from "./private-offer-review";
import type { PrivateOfferTemplateProduct } from "./private-offer-template-types";

export type { PrivateOfferCurrency } from "./private-offer-editor-model";
export type { PrivateOfferTemplateProduct } from "./private-offer-template-types";

export interface PrivateOfferComposerProject {
  id: string;
  title: string;
}

export interface PrivateOfferComposerRecipient {
  id: string;
  name: string;
  email: string;
  projects: PrivateOfferComposerProject[];
}

export type PrivateOfferComposerRecipientPayload =
  | { kind: "existing"; clientContactId: string }
  | { kind: "new"; name: string; email: string };

export type PrivateOfferComposerTargetPayload =
  | { kind: "new" }
  | { kind: "existing"; projectId: string };

export interface PrivateOfferComposerInitialOffer {
  id: string;
  clientContactId: string;
  targetProjectId: string | null;
  terms: PrivateOfferInput;
  expiresAt: string;
  expectedUpdatedAt: string;
  recipientName?: string;
  recipientEmail?: string;
}

export interface SendPrivateOfferComposerPayload {
  offerId: string;
  sourceProductId?: string;
  recipient: PrivateOfferComposerRecipientPayload;
  target: PrivateOfferComposerTargetPayload;
  terms: PrivateOfferInput;
  expiresAt: string;
}

export interface UpdatePrivateOfferComposerPayload {
  offerId: string;
  expectedUpdatedAt: string;
  recipient: PrivateOfferComposerRecipientPayload;
  target: PrivateOfferComposerTargetPayload;
  terms: PrivateOfferInput;
  expiresAt: string;
}

interface PrivateOfferComposerCommonProps {
  recipients: PrivateOfferComposerRecipient[];
  lockedClientId?: string;
  taxMode: TaxMode;
  taxRatePct: number;
  defaultCurrency: PrivateOfferCurrency;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (offerId: string) => void;
  trigger?: ReactElement | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export type PrivateOfferComposerProps = PrivateOfferComposerCommonProps &
  (
    | {
        initialOffer: PrivateOfferComposerInitialOffer;
        templateProduct?: never;
      }
    | {
        initialOffer?: undefined;
        templateProduct?: PrivateOfferTemplateProduct;
      }
  );

type FullStep =
  | "recipient"
  | "type"
  | "details"
  | "price"
  | "payment"
  | "delivery"
  | "rights"
  | "review";
type QuickStep = "quick" | "review";
type ComposerStep = FullStep | QuickStep;
type ComposerFlow = "quick" | "full";

const CUSTOM_FULL_STEPS = [
  "recipient",
  "type",
  "details",
  "price",
  "payment",
  "delivery",
  "rights",
  "review",
] as const;
const EXISTING_FULL_STEPS = [
  "recipient",
  "details",
  "price",
  "payment",
  "delivery",
  "rights",
  "review",
] as const;
const QUICK_STEPS = ["quick", "review"] as const;
const PRIVATE_OFFER_DRAFT_VERSION = 1 as const;
const PRIVATE_OFFER_AUTOSAVE_DELAY_MS = 250;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateOfferDraftEntryKey(input: {
  initialOffer?: PrivateOfferComposerInitialOffer;
  templateProduct?: PrivateOfferTemplateProduct;
  lockedClientId?: string;
}): string {
  if (input.initialOffer) {
    return `edit:${input.initialOffer.id}:${input.initialOffer.expectedUpdatedAt}`;
  }
  if (input.templateProduct) {
    const templateKey = `template:${input.templateProduct.source.productId}`;
    return input.lockedClientId ? `${templateKey}:client:${input.lockedClientId}` : templateKey;
  }
  if (input.lockedClientId) return `client:${input.lockedClientId}`;
  return "custom";
}

function decodePersistedComposerStep(
  value: string,
  allowedFullSteps: readonly ComposerStep[],
  quickAvailable: boolean,
): { flow: ComposerFlow; step: ComposerStep } | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const flow = value.slice(0, separator);
  const step = value.slice(separator + 1) as ComposerStep;
  if (flow === "quick" && quickAvailable && QUICK_STEPS.includes(step as QuickStep)) {
    return { flow, step };
  }
  if (flow === "full" && allowedFullSteps.includes(step) && step !== "quick") {
    return { flow, step };
  }
  return null;
}

const STEP_COPY: Record<ComposerStep, Readonly<{ title: string; subtitle: string }>> = {
  quick: {
    title: "Recipient & price",
    subtitle: "Choose who receives it, where accepted work goes, and the private price.",
  },
  recipient: {
    title: "Recipient & project",
    subtitle: "Choose the invited artist and the project created when they accept.",
  },
  type: {
    title: "What are you offering?",
    subtitle: "Start with the same product presets used in your Store.",
  },
  details: {
    title: "Details & deliverables",
    subtitle: "Describe the exact work included in this offer.",
  },
  price: {
    title: "Price & tax",
    subtitle: "Set the private subtotal, currency, and tax treatment.",
  },
  payment: {
    title: "Payment options",
    subtitle: "Choose every schedule the artist may select when accepting.",
  },
  delivery: {
    title: "Delivery & sessions",
    subtitle: "Set song spaces, bookable time, and revision limits.",
  },
  rights: {
    title: "Rights & agreement",
    subtitle: "Write the exact rights and agreement the artist will accept.",
  },
  review: {
    title: "Review & send",
    subtitle: "This is the exact offer the artist will receive.",
  },
};

function optionMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function privateOfferProjectOptionLabel(project: PrivateOfferProjectOption): string {
  const createdAt = new Date(project.createdAtIso);
  const date = Number.isNaN(createdAt.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(createdAt);
  const songs = `${String(project.songCount)} ${project.songCount === 1 ? "song" : "songs"}`;
  const balance =
    project.balances.length === 0
      ? "No purchase balance"
      : project.balances.every(({ remainingCents }) => remainingCents === 0)
        ? "Paid"
        : `Balance: ${project.balances
            .filter(({ remainingCents }) => remainingCents !== 0)
            .map(({ currency, remainingCents }) => optionMoney(remainingCents, currency))
            .join(" + ")}`;
  return `${project.title} · ${date} · ${songs} · ${balance}`;
}

function stepFromValidationError(error: PrivateOfferDraftError["step"]): FullStep {
  return error;
}

function planPatch(plan: "full" | "split" | "installments") {
  return {
    fullPlan: plan === "full",
    splitPlan: plan === "split",
    monthlyPlan: plan === "installments",
  };
}

function presetDraftPatch(id: PresetId, draft: PrivateOfferComposerDraft) {
  const preset = getPreset(id);
  if (!preset) return { presetId: id };
  const durationMatch = preset.preset.duration.match(/^(\d+)\s*min$/i);
  return {
    presetId: id,
    name: draft.name.trim() ? draft.name : preset.defaultName,
    service: id === "blank" ? draft.service : preset.label,
    deliverables: preset.baseline.join("\n"),
    cashPrice: preset.preset.price.toFixed(2),
    includedSongSpaces: id === "blank" ? draft.includedSongSpaces : "1",
    hasSessionAllowance: preset.preset.includesSessions,
    sessionLimitMode: preset.preset.unlimitedSessions ? ("unlimited" as const) : ("fixed" as const),
    sessionCount: String(Math.max(1, preset.preset.sessions)),
    sessionDurationMin: durationMatch?.[1] ?? "60",
    revisionMode: "fixed" as const,
    revisionCount: String(preset.preset.revisions),
    ...planPatch(preset.preset.paymentPlan),
  };
}

function quickTemplateQuantityError(
  draft: PrivateOfferComposerDraft,
  templateProduct: PrivateOfferTemplateProduct | undefined,
): PrivateOfferDraftError | null {
  if (templateProduct?.pricing.kind !== "per_song") return null;
  const result = validatePrivateOfferTemplateQuantity(draft, templateProduct.pricing);
  return "error" in result ? result.error : null;
}

function defaultTrigger(editing: boolean): ReactElement {
  return (
    <button
      type="button"
      className={`sk-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold transition-[filter,opacity] ${
        editing
          ? "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
          : "border border-transparent bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))] shadow-[0_8px_24px_-18px_rgb(var(--brand-primary)/0.75)] hover:brightness-105"
      }`}
    >
      {editing ? (
        <Pencil className="h-4 w-4" aria-hidden />
      ) : (
        <Plus className="h-4 w-4" aria-hidden />
      )}
      {editing ? "Edit private offer" : "New private offer"}
    </button>
  );
}

export function PrivateOfferComposer(props: PrivateOfferComposerProps) {
  const {
    recipients,
    lockedClientId: lockedClientIdProp,
    taxMode,
    taxRatePct,
    defaultCurrency,
    open: controlledOpen,
    onOpenChange,
    onCreated,
    trigger,
    returnFocusRef,
  } = props;
  const initialOffer = "initialOffer" in props ? props.initialOffer : undefined;
  const templateProduct = "templateProduct" in props ? props.templateProduct : undefined;
  const editing = initialOffer !== undefined;
  const lockedClientId = lockedClientIdProp ?? initialOffer?.clientContactId;
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnlineStatus();
  const {
    record: runtimeDraftRecord,
    loaded: runtimeDraftLoaded,
    save: saveRuntimeDraft,
    clear: clearRuntimeDraft,
  } = useProducerPrivateOfferDraft({ route: pathname });
  const idPrefix = useId().replace(/:/g, "");
  const entryKey = privateOfferDraftEntryKey({
    ...(initialOffer ? { initialOffer } : {}),
    ...(templateProduct ? { templateProduct } : {}),
    ...(lockedClientIdProp ? { lockedClientId: lockedClientIdProp } : {}),
  });
  const initialFlow: ComposerFlow = templateProduct ? "quick" : "full";
  const initialStep: ComposerStep = templateProduct ? "quick" : "recipient";
  const seededDraft = useMemo(
    () =>
      seedPrivateOfferDraft({
        defaultCurrency,
        taxMode,
        taxRatePct,
        ...(lockedClientIdProp ? { lockedClientId: lockedClientIdProp } : {}),
        ...(initialOffer ? { initialOffer } : {}),
        ...(templateProduct ? { templateProduct } : {}),
      }),
    [defaultCurrency, initialOffer, lockedClientIdProp, taxMode, taxRatePct, templateProduct],
  );
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [pending, setPending] = useState(false);
  const [flow, setFlow] = useState<ComposerFlow>(initialFlow);
  const [currentStep, setCurrentStep] = useState<ComposerStep>(initialStep);
  const [draft, setDraft] = useState<PrivateOfferComposerDraft>(seededDraft);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<PrivateOfferDraftField | null>(null);
  const [missingStep, setMissingStep] = useState<FullStep | null>(null);
  const [returnToReview, setReturnToReview] = useState(false);
  const [reviewValue, setReviewValue] = useState<PrivateOfferReviewDraft | null>(null);
  const [projectOptionsByClient, setProjectOptionsByClient] = useState<
    Record<string, readonly PrivateOfferProjectOption[]>
  >({});
  const [loadedProjectClientIds, setLoadedProjectClientIds] = useState<string[]>([]);
  const [loadingProjectClientId, setLoadingProjectClientId] = useState<string | null>(null);
  const [projectLoadErrorsByClient, setProjectLoadErrorsByClient] = useState<
    Record<string, string>
  >({});
  const [submissionOfferId, setSubmissionOfferId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [persistenceReady, setPersistenceReady] = useState(false);
  const submissionOfferIdRef = useRef<string | null>(null);
  const submitInFlightRef = useRef(false);
  const projectLoadRequestRef = useRef<{ clientId: string; token: symbol } | null>(null);
  const initializedEntryRef = useRef<string | null>(null);
  const suppressPersistenceRef = useRef(false);
  const persistenceReadyRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const saveStatusTimerRef = useRef<number | null>(null);
  const errorAlertRef = useRef<HTMLDivElement>(null);
  const latestDraftRef = useRef(draft);
  const latestFlowRef = useRef(flow);
  const latestStepRef = useRef(currentStep);
  const latestSubmissionOfferIdRef = useRef(submissionOfferId);
  const persistLatestDraftRef = useRef<
    ((override?: { submissionOfferId: string | null }, quiet?: boolean) => boolean) | null
  >(null);

  latestDraftRef.current = draft;
  latestFlowRef.current = flow;
  latestStepRef.current = currentStep;
  latestSubmissionOfferIdRef.current = submissionOfferId;
  submissionOfferIdRef.current = submissionOfferId;

  const fullSteps = useMemo<readonly ComposerStep[]>(
    () => (templateProduct || editing ? EXISTING_FULL_STEPS : CUSTOM_FULL_STEPS),
    [editing, templateProduct],
  );
  const steps = useMemo<readonly ComposerStep[]>(() => {
    if (flow === "quick") return QUICK_STEPS;
    return fullSteps;
  }, [flow, fullSteps]);
  const stepIndex = Math.max(0, steps.indexOf(currentStep));
  const isFirstStep = stepIndex === 0;
  const isLastStep = currentStep === "review";
  const selectedClientId =
    lockedClientId ?? (draft.recipientKind === "existing" ? draft.clientContactId : "");
  const currentSelectedRecipient = recipients.find(
    (recipient) => recipient.id === selectedClientId,
  );
  const editRecipientFallback =
    editing && lockedClientId
      ? {
          id: lockedClientId,
          name: initialOffer.recipientName ?? currentSelectedRecipient?.name ?? "Selected client",
          email: initialOffer.recipientEmail ?? currentSelectedRecipient?.email ?? "",
          projects: [] as PrivateOfferComposerProject[],
        }
      : null;
  const editorRecipients = editRecipientFallback
    ? [
        ...recipients.filter((recipient) => recipient.id !== editRecipientFallback.id),
        editRecipientFallback,
      ]
    : recipients;
  const selectedRecipient = editorRecipients.find((recipient) => recipient.id === selectedClientId);
  const availableProjects = selectedClientId
    ? (projectOptionsByClient[selectedClientId] ?? [])
    : [];
  const projectsLoaded = selectedClientId
    ? loadedProjectClientIds.includes(selectedClientId)
    : false;
  const loadingProjects = loadingProjectClientId === selectedClientId;
  const projectLoadError = selectedClientId
    ? (projectLoadErrorsByClient[selectedClientId] ?? null)
    : null;
  const selectedProject = availableProjects.find((project) => project.id === draft.targetProjectId);
  const validated = validatePrivateOfferDraft(draft, lockedClientId, availableProjects);
  const validReview = "value" in validated ? validated.value : reviewValue;
  const copy = STEP_COPY[currentStep];

  const finishDraftSave = useCallback((written: boolean) => {
    setSaveStatus(written ? "saved" : "error");
    if (saveStatusTimerRef.current !== null) {
      window.clearTimeout(saveStatusTimerRef.current);
    }
    if (written) {
      saveStatusTimerRef.current = window.setTimeout(() => {
        setSaveStatus("idle");
      }, 2_000);
    }
  }, []);

  const persistLatestDraft = useCallback(
    (override?: { submissionOfferId: string | null }, quiet = false) => {
      if (!persistenceReadyRef.current || suppressPersistenceRef.current) return false;
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const nextSubmissionOfferId =
        override?.submissionOfferId ?? latestSubmissionOfferIdRef.current;
      const record: ProducerPrivateOfferDraft = {
        version: PRIVATE_OFFER_DRAFT_VERSION,
        entryKey,
        mode: editing ? "edit" : "new",
        existingOfferId: initialOffer?.id ?? null,
        expectedUpdatedAt: initialOffer?.expectedUpdatedAt ?? null,
        currentStep: `${latestFlowRef.current}:${latestStepRef.current}`,
        draftJson: JSON.stringify(latestDraftRef.current),
        submissionOfferId: editing ? null : nextSubmissionOfferId,
      };
      const written = saveRuntimeDraft(record);
      if (!quiet) finishDraftSave(written);
      return written;
    },
    [editing, entryKey, finishDraftSave, initialOffer, saveRuntimeDraft],
  );
  persistLatestDraftRef.current = persistLatestDraft;

  function resetLogicalDraft() {
    setFlow(initialFlow);
    setCurrentStep(initialStep);
    setDraft(seededDraft);
    setError(null);
    setInvalidField(null);
    setMissingStep(null);
    setReturnToReview(false);
    setReviewValue(null);
    setSubmissionOfferId(null);
    submissionOfferIdRef.current = null;
    latestSubmissionOfferIdRef.current = null;
    submitInFlightRef.current = false;
    setPending(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && (pending || submitInFlightRef.current)) return;
    if (!nextOpen) persistLatestDraft();
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function clearLogicalDraftAndClose() {
    suppressPersistenceRef.current = true;
    persistenceReadyRef.current = false;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    clearRuntimeDraft();
    setSaveStatus("idle");
    resetLogicalDraft();
    if (controlledOpen === undefined) setUncontrolledOpen(false);
    onOpenChange?.(false);
  }

  useLayoutEffect(() => {
    if (!open) {
      initializedEntryRef.current = null;
      persistenceReadyRef.current = false;
      setPersistenceReady(false);
      return;
    }
    if (!runtimeDraftLoaded || initializedEntryRef.current === entryKey) return;

    suppressPersistenceRef.current = true;
    persistenceReadyRef.current = false;
    setPersistenceReady(false);
    initializedEntryRef.current = entryKey;
    submitInFlightRef.current = false;

    const expectedMode = editing ? "edit" : "new";
    const matchingRecord =
      runtimeDraftRecord?.version === PRIVATE_OFFER_DRAFT_VERSION &&
      runtimeDraftRecord.entryKey === entryKey &&
      runtimeDraftRecord.mode === expectedMode &&
      runtimeDraftRecord.existingOfferId === (initialOffer?.id ?? null) &&
      runtimeDraftRecord.expectedUpdatedAt === (initialOffer?.expectedUpdatedAt ?? null);
    const restoredDraft = matchingRecord
      ? parsePrivateOfferComposerDraftJson(runtimeDraftRecord.draftJson)
      : null;
    const restoredLocation = matchingRecord
      ? decodePersistedComposerStep(
          runtimeDraftRecord.currentStep,
          fullSteps,
          templateProduct !== undefined,
        )
      : null;

    setError(null);
    setInvalidField(null);
    setMissingStep(null);
    setReturnToReview(false);
    setReviewValue(null);

    if (restoredDraft && restoredLocation) {
      let nextFlow = restoredLocation.flow;
      let nextStep = restoredLocation.step;
      if (nextStep === "review") {
        const quantityError =
          nextFlow === "quick" ? quickTemplateQuantityError(restoredDraft, templateProduct) : null;
        const restoredClientId =
          lockedClientId ??
          (restoredDraft.recipientKind === "existing" ? restoredDraft.clientContactId : "");
        const restoredProjects = restoredClientId
          ? (projectOptionsByClient[restoredClientId] ?? [])
          : [];
        const waitingForRestoredProjects =
          restoredDraft.targetKind === "existing" &&
          restoredClientId.length > 0 &&
          !loadedProjectClientIds.includes(restoredClientId);
        if (quantityError) {
          nextStep = "quick";
          setError(quantityError.message);
          setInvalidField(quantityError.field);
        } else if (!waitingForRestoredProjects) {
          const restoredValidation = validatePrivateOfferReviewDraft(
            restoredDraft,
            lockedClientId,
            restoredProjects,
          );
          if ("value" in restoredValidation) {
            setReviewValue(restoredValidation.value);
          } else {
            nextFlow = "full";
            nextStep = stepFromValidationError(restoredValidation.error.step);
            setError(restoredValidation.error.message);
            setInvalidField(restoredValidation.error.field);
            setMissingStep(nextStep as FullStep);
          }
        }
      }
      setFlow(nextFlow);
      setCurrentStep(nextStep);
      setDraft(restoredDraft);
      const candidateSubmissionOfferId = runtimeDraftRecord?.submissionOfferId ?? null;
      const restoredSubmissionOfferId =
        !editing && candidateSubmissionOfferId && UUID_PATTERN.test(candidateSubmissionOfferId)
          ? candidateSubmissionOfferId
          : null;
      setSubmissionOfferId(restoredSubmissionOfferId);
      submissionOfferIdRef.current = restoredSubmissionOfferId;
      latestSubmissionOfferIdRef.current = restoredSubmissionOfferId;
    } else {
      resetLogicalDraft();
    }

    suppressPersistenceRef.current = false;
    persistenceReadyRef.current = true;
    setPersistenceReady(true);
  }, [
    editing,
    entryKey,
    fullSteps,
    initialOffer,
    initialFlow,
    initialStep,
    loadedProjectClientIds,
    lockedClientId,
    open,
    projectOptionsByClient,
    runtimeDraftLoaded,
    runtimeDraftRecord,
    seededDraft,
    templateProduct,
  ]);

  useEffect(() => {
    if (!open || !persistenceReady || suppressPersistenceRef.current) return;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    setSaveStatus("saving");
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      persistLatestDraft();
    }, PRIVATE_OFFER_AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [currentStep, draft, flow, open, persistLatestDraft, persistenceReady, submissionOfferId]);

  useEffect(() => {
    if (!open || !persistenceReady) return;
    const flush = () => {
      persistLatestDraft();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [open, persistLatestDraft, persistenceReady]);

  useEffect(() => {
    return () => {
      persistLatestDraftRef.current?.(undefined, true);
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
      if (saveStatusTimerRef.current !== null) window.clearTimeout(saveStatusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open || !error) return;
    const frame = window.requestAnimationFrame(() => {
      if (invalidField) {
        const field = document.querySelector<HTMLElement>(
          `[data-private-offer-field="${invalidField}"]`,
        );
        if (field) {
          field.focus();
          return;
        }
      }
      errorAlertRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [currentStep, error, invalidField, open]);

  useEffect(() => {
    if (
      !open ||
      draft.recipientKind === "new" ||
      !selectedClientId ||
      projectsLoaded ||
      projectLoadError !== null
    ) {
      return;
    }
    if (projectLoadRequestRef.current?.clientId === selectedClientId) return;
    if (!online) {
      setProjectLoadErrorsByClient((current) => ({
        ...current,
        [selectedClientId]: "Reconnect to load this client’s projects.",
      }));
      return;
    }

    let active = true;
    const token = Symbol(selectedClientId);
    projectLoadRequestRef.current = { clientId: selectedClientId, token };
    setLoadingProjectClientId(selectedClientId);
    setProjectLoadErrorsByClient((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([clientId]) => clientId !== selectedClientId),
      ),
    );
    void loadPrivateOfferProjectOptionsAction(selectedClientId)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setProjectLoadErrorsByClient((current) => ({
            ...current,
            [selectedClientId]: result.error,
          }));
          setProjectOptionsByClient((current) => ({ ...current, [selectedClientId]: [] }));
          return;
        }
        setLoadedProjectClientIds((current) =>
          current.includes(selectedClientId) ? current : [...current, selectedClientId],
        );
        setProjectOptionsByClient((current) => ({ ...current, [selectedClientId]: result.data }));
      })
      .catch(() => {
        if (active) {
          setProjectLoadErrorsByClient((current) => ({
            ...current,
            [selectedClientId]: "Could not load this client’s projects. Try again.",
          }));
        }
      })
      .finally(() => {
        if (projectLoadRequestRef.current?.token !== token) return;
        projectLoadRequestRef.current = null;
        setLoadingProjectClientId((current) => (current === selectedClientId ? null : current));
      });
    return () => {
      active = false;
      if (projectLoadRequestRef.current?.token === token) {
        projectLoadRequestRef.current = null;
        setLoadingProjectClientId((current) => (current === selectedClientId ? null : current));
      }
    };
  }, [draft.recipientKind, online, open, projectLoadError, projectsLoaded, selectedClientId]);

  useEffect(() => {
    if (!open || currentStep !== "review" || reviewValue !== null) return;

    const quantityError =
      flow === "quick" ? quickTemplateQuantityError(draft, templateProduct) : null;
    if (quantityError) {
      setCurrentStep("quick");
      setError(quantityError.message);
      setInvalidField(quantityError.field);
      return;
    }

    if (draft.targetKind === "existing" && !projectsLoaded) {
      if (projectLoadError) {
        setFlow("full");
        setCurrentStep("recipient");
        setMissingStep("recipient");
        setReturnToReview(true);
        setError(projectLoadError);
        setInvalidField(null);
      }
      return;
    }

    const restoredValidation = validatePrivateOfferReviewDraft(
      draft,
      lockedClientId,
      availableProjects,
    );
    if ("value" in restoredValidation) {
      setReviewValue(restoredValidation.value);
      return;
    }
    setFlow("full");
    setCurrentStep(stepFromValidationError(restoredValidation.error.step));
    setMissingStep(stepFromValidationError(restoredValidation.error.step));
    setReturnToReview(true);
    setError(restoredValidation.error.message);
    setInvalidField(restoredValidation.error.field);
  }, [
    availableProjects,
    currentStep,
    draft,
    flow,
    lockedClientId,
    open,
    projectLoadError,
    projectsLoaded,
    reviewValue,
    templateProduct,
  ]);

  function patch(next: Partial<PrivateOfferComposerDraft>) {
    if (pending || submitInFlightRef.current) return;
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
    setInvalidField(null);
    setMissingStep(null);
  }

  function moveToStep(step: ComposerStep) {
    setCurrentStep(step);
    setError(null);
    setInvalidField(null);
    setMissingStep(null);
  }

  function completeMissingTerms(step = missingStep) {
    setFlow("full");
    setReturnToReview(false);
    setCurrentStep(step ?? "details");
    setMissingStep(null);
  }

  function customizeTerms() {
    const recipient = validatePrivateOfferStep(
      "recipient",
      draft,
      lockedClientId,
      availableProjects,
    );
    completeMissingTerms("error" in recipient ? "recipient" : "details");
  }

  function showValidationError(validationError: PrivateOfferDraftError) {
    setError(validationError.message);
    setInvalidField(validationError.field);
    setMissingStep(
      validationError.step === "review" ? null : stepFromValidationError(validationError.step),
    );
  }

  function handleContinue() {
    if (pending) return;
    if (flow === "quick" && currentStep === "quick") {
      const quantityError = quickTemplateQuantityError(draft, templateProduct);
      if (quantityError) {
        showValidationError(quantityError);
        return;
      }
      const result = validatePrivateOfferReviewDraft(draft, lockedClientId, availableProjects);
      if ("error" in result) {
        showValidationError(result.error);
        return;
      }
      setReviewValue(result.value);
      moveToStep("review");
      return;
    }

    if (currentStep === "type") {
      if (!draft.presetId) {
        setError("Choose an offer type to continue.");
        setInvalidField("presetId");
        return;
      }
    } else if (currentStep !== "review" && currentStep !== "quick") {
      const result = validatePrivateOfferStep(
        currentStep,
        draft,
        lockedClientId,
        availableProjects,
      );
      if ("error" in result) {
        showValidationError(result.error);
        return;
      }
    }

    if (returnToReview && currentStep !== "review") {
      const result = validatePrivateOfferReviewDraft(draft, lockedClientId, availableProjects);
      if ("error" in result) {
        showValidationError(result.error);
        return;
      }
      setReviewValue(result.value);
      setReturnToReview(false);
      moveToStep("review");
      return;
    }

    const next = steps[stepIndex + 1];
    if (!next) return;
    if (next === "review") {
      const result = validatePrivateOfferReviewDraft(draft, lockedClientId, availableProjects);
      if ("error" in result) {
        showValidationError(result.error);
        return;
      }
      setReviewValue(result.value);
    }
    moveToStep(next);
  }

  function handleBack() {
    if (pending || isFirstStep) return;
    const previous = steps[stepIndex - 1];
    if (previous) moveToStep(previous);
  }

  function handleReviewEdit(step: PrivateOfferReviewEditStep) {
    if (pending || submitInFlightRef.current) return;
    if (flow === "quick") setFlow("full");
    setReturnToReview(true);
    moveToStep(step);
  }

  function handleSubmit() {
    if (pending || submitInFlightRef.current) return;
    if (!online) {
      setError(
        editing
          ? "Reconnect to update this private offer."
          : "Reconnect to send this private offer.",
      );
      setInvalidField(null);
      return;
    }
    if (flow === "quick") {
      const quantityError = quickTemplateQuantityError(draft, templateProduct);
      if (quantityError) {
        setCurrentStep("quick");
        showValidationError(quantityError);
        return;
      }
    }
    const result = validatePrivateOfferDraft(draft, lockedClientId, availableProjects);
    if ("error" in result) {
      if (result.error.step !== "review") {
        setFlow("full");
        setReturnToReview(false);
        setCurrentStep(stepFromValidationError(result.error.step));
      }
      showValidationError(result.error);
      return;
    }
    const value = result.value;
    setReviewValue(value);
    let createOfferId: string | null = null;
    if (!initialOffer) {
      createOfferId = submissionOfferIdRef.current ?? crypto.randomUUID();
      if (submissionOfferIdRef.current === null) {
        submissionOfferIdRef.current = createOfferId;
        latestSubmissionOfferIdRef.current = createOfferId;
        setSubmissionOfferId(createOfferId);
      }
      // This write is intentionally synchronous and must succeed before the
      // action. If browser storage is unavailable, sending would make an
      // ambiguous response unsafe to recover after reload. Keep the same id
      // in memory and let a later retry persist that exact logical send.
      if (!persistLatestDraft({ submissionOfferId: createOfferId })) {
        const message =
          "Your browser couldn’t safely save this send. Nothing was sent. Check site storage and try again.";
        setError(message);
        setInvalidField(null);
        toast(message, "error");
        return;
      }
    }
    submitInFlightRef.current = true;
    setPending(true);
    void (async () => {
      try {
        const actionResult = initialOffer
          ? await updatePrivateOfferAction({
              offerId: initialOffer.id,
              expectedUpdatedAt: initialOffer.expectedUpdatedAt,
              recipient: value.recipient.recipient,
              target: value.recipient.target,
              terms: value.terms,
              expiresAt: value.expiry.toISOString(),
            } satisfies UpdatePrivateOfferComposerPayload)
          : await sendPrivateOfferAction({
              offerId: createOfferId ?? submissionOfferIdRef.current ?? crypto.randomUUID(),
              ...(templateProduct ? { sourceProductId: templateProduct.source.productId } : {}),
              recipient: value.recipient.recipient,
              target: value.recipient.target,
              terms: value.terms,
              expiresAt: value.expiry.toISOString(),
            } satisfies SendPrivateOfferComposerPayload);

        if (!actionResult.ok) {
          submitInFlightRef.current = false;
          setPending(false);
          setError(actionResult.error);
          setInvalidField(null);
          toast(actionResult.error, "error");
          return;
        }
        if (
          !editing &&
          "emailDelivered" in actionResult.data &&
          actionResult.data.emailDelivered === null
        ) {
          toast("Offer was already saved. No duplicate or second email was sent.", "info");
        } else if (
          !editing &&
          "emailDelivered" in actionResult.data &&
          actionResult.data.emailDelivered === false
        ) {
          toast(
            "Offer sent, but the notification email could not be delivered. It is still available in the app.",
            "info",
          );
        } else {
          toast(editing ? "Private offer updated." : "Private offer sent.", "success");
        }
        if (!editing) onCreated?.(actionResult.data.id);
        clearLogicalDraftAndClose();
        if (editing || !onCreated) router.refresh();
      } catch {
        submitInFlightRef.current = false;
        setPending(false);
        const message = editing
          ? "The offer couldn’t be updated. Try again."
          : "The offer couldn’t be sent. Try again.";
        setError(message);
        setInvalidField(null);
        toast(message, "error");
      }
    })();
  }

  const projectStepProps = {
    idPrefix,
    draft,
    recipients: editorRecipients,
    ...(lockedClientId ? { lockedClientId } : {}),
    projects: availableProjects.map((project) => ({
      id: project.id,
      label: privateOfferProjectOptionLabel(project),
    })),
    projectsStatus: loadingProjects
      ? ("loading" as const)
      : projectLoadError
        ? ("error" as const)
        : projectsLoaded
          ? ("ready" as const)
          : ("idle" as const),
    ...(projectLoadError ? { projectsError: projectLoadError } : {}),
    invalidField,
    ...(selectedClientId
      ? {
          onRetryProjects: () => {
            setProjectLoadErrorsByClient((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([clientId]) => clientId !== selectedClientId),
              ),
            );
            setLoadedProjectClientIds((current) =>
              current.filter((clientId) => clientId !== selectedClientId),
            );
          },
        }
      : {}),
    patch,
  };

  let body: React.ReactNode;
  if (currentStep === "quick" && templateProduct) {
    body = <PrivateOfferQuickStep {...projectStepProps} templateProduct={templateProduct} />;
  } else if (currentStep === "recipient") {
    body = <RecipientProjectFields {...projectStepProps} />;
  } else if (currentStep === "type") {
    body = (
      <div
        data-private-offer-field="presetId"
        aria-invalid={invalidField === "presetId" ? true : undefined}
        tabIndex={-1}
      >
        <TypeStep
          picked={draft.presetId}
          onPick={(presetId) => {
            patch(presetDraftPatch(presetId, draft));
          }}
        />
      </div>
    );
  } else if (currentStep === "details") {
    body = (
      <PrivateOfferDetailsStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (currentStep === "price") {
    body = (
      <PrivateOfferPriceStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (currentStep === "payment") {
    body = <PrivateOfferPaymentStep draft={draft} invalidField={invalidField} patch={patch} />;
  } else if (currentStep === "delivery") {
    body = (
      <PrivateOfferDeliveryStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (currentStep === "rights") {
    body = (
      <PrivateOfferRightsStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (validReview) {
    const lockedIdentity = lockedClientId ? selectedRecipient : undefined;
    const recipientName = lockedIdentity
      ? lockedIdentity.name
      : (initialOffer?.recipientName ??
        (draft.recipientKind === "new"
          ? draft.newRecipientName.trim()
          : (selectedRecipient?.name ?? "Selected client")));
    const recipientEmail = privateOfferRecipientEmail(
      draft,
      lockedIdentity?.email ?? initialOffer?.recipientEmail,
      recipients,
    );
    body = (
      <PrivateOfferReview
        snapshot={validReview.snapshot}
        targetLabel={
          validReview.recipient.target.kind === "new"
            ? "New project"
            : (selectedProject?.title ?? "Existing project")
        }
        recipientName={recipientName}
        recipientEmail={recipientEmail}
        expiresAtLocal={draft.expiresAtLocal}
        invalidField={invalidField}
        onExpiresAtLocalChange={(expiresAtLocal) => {
          patch({ expiresAtLocal });
        }}
        onEdit={handleReviewEdit}
        {...(templateProduct ? { sourceTemplateName: templateProduct.source.productName } : {})}
      />
    );
  } else if (
    currentStep === "review" &&
    draft.targetKind === "existing" &&
    selectedClientId &&
    !projectsLoaded &&
    !projectLoadError
  ) {
    body = (
      <div
        role="status"
        className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 text-[13px] text-[rgb(var(--fg-muted))]"
      >
        Loading this project before showing the offer review…
      </div>
    );
  } else {
    body = (
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 text-[13px] text-[rgb(var(--fg-muted))]">
        Complete the missing terms before reviewing this offer.
      </div>
    );
  }

  const completeMissing = templateProduct && flow === "quick" && missingStep;
  const shellTrigger = trigger === null ? null : (trigger ?? defaultTrigger(editing));
  const productName = initialOffer?.terms.name ?? templateProduct?.source.productName;

  return (
    <EditorShell
      open={open}
      onOpenChange={handleOpenChange}
      trigger={shellTrigger}
      {...(returnFocusRef ? { returnFocusRef } : {})}
      mode={editing ? "edit" : "new"}
      {...(productName ? { productName } : {})}
      steps={steps}
      current={currentStep}
      title={copy.title}
      subtitle={copy.subtitle}
      canContinue={!pending && (currentStep !== "type" || draft.presetId !== null)}
      onBack={handleBack}
      onContinue={handleContinue}
      onSave={handleSubmit}
      onPublish={handleSubmit}
      onSaveHidden={handleSubmit}
      onDiscard={() => {
        clearLogicalDraftAndClose();
      }}
      isLastStep={isLastStep}
      isFirstStep={isFirstStep}
      pending={pending}
      pendingAction={editing ? "edit" : "publish"}
      saveStatus={saveStatus}
      editorLabel={editing ? "Edit private offer" : "Send a private offer"}
      stepLabel={`Step ${String(stepIndex + 1)} of ${String(steps.length)} · ${
        editing ? "EDITING PRIVATE OFFER" : "PRIVATE OFFER"
      }`}
      progressLabel="Private offer setup progress"
      closeLabel="Close private offer editor"
      continueLabel={currentStep === "quick" ? "Review offer →" : "Continue →"}
      finalNote={
        editing
          ? "The artist sees these corrections immediately. Accepted offers stay locked."
          : "Sending notifies the invited artist and locks the offer to their verified email."
      }
      showDiscard
      discardLabel="Discard draft"
      {...(templateProduct && flow === "quick"
        ? {
            utilityAction: {
              label: completeMissing ? "Complete missing terms" : "Customize terms",
              onClick: completeMissing
                ? () => {
                    completeMissingTerms();
                  }
                : customizeTerms,
            },
          }
        : {})}
      finalActions={[
        {
          label: editing ? "Save corrections" : "Send private offer",
          pendingLabel: editing ? "Saving…" : "Sending…",
          onClick: handleSubmit,
          variant: "primary",
        },
      ]}
    >
      {error ? (
        <div
          ref={errorAlertRef}
          role="alert"
          tabIndex={-1}
          className="mb-4 flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.07)] px-3 py-2.5 text-[12.5px] font-medium text-[rgb(var(--fg-danger))] sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{error}</span>
          {completeMissing ? (
            <button
              type="button"
              onClick={() => {
                completeMissingTerms();
              }}
              className="sk-press shrink-0 self-start rounded-[var(--radius-md)] bg-[rgb(var(--fg-default))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--bg-elevated))] sm:self-auto"
            >
              Complete missing terms
            </button>
          ) : null}
        </div>
      ) : null}
      {body}
    </EditorShell>
  );
}
