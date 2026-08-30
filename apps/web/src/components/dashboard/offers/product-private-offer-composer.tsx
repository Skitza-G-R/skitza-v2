"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactElement,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { EditorShell } from "~/app/(producer)/dashboard/store/editor-shell";
import {
  cancelAgreementPdfUpload,
  prepareAgreementPdfUpload,
} from "~/app/(producer)/dashboard/booking/actions";
import {
  loadPrivateOfferProjectOptionsAction,
  sendPrivateOfferAction,
  type PrivateOfferAgreementPdfPayload,
  type PrivateOfferProjectOption,
  updatePrivateOfferAction,
} from "~/app/(producer)/dashboard/store/private-offer-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { agreementPdfFileError } from "~/lib/agreement-pdf";
import type { TaxMode } from "~/lib/tax-mode";

import {
  privateOfferRecipientEmail,
  seedPrivateOfferDraft,
  validatePrivateOfferDraft,
  validatePrivateOfferReviewDraft,
  validatePrivateOfferStep,
  type PrivateOfferComposerDraft,
  type PrivateOfferCurrency,
  type PrivateOfferDraftError,
  type PrivateOfferDraftField,
  type PrivateOfferReviewDraft,
} from "./private-offer-editor-model";
import {
  PrivateOfferCompactPriceStep,
  PrivateOfferDeliveryStep,
  PrivateOfferDetailsStep,
  PrivateOfferPaymentStep,
  PrivateOfferPriceStep,
  PrivateOfferRecipientStep,
  PrivateOfferRightsStep,
  PrivateOfferTopProgress,
} from "./private-offer-editor-steps";
import { ProductPrivateOfferReview } from "./private-offer-review";
import type { PrivateOfferTemplateProduct } from "./private-offer-template-types";
import type {
  PrivateOfferComposerInitialOffer,
  PrivateOfferComposerRecipient,
  PrivateOfferSentSummary,
} from "./private-offer-composer";

type QuickStep = "recipient" | "price" | "review";
type CustomizeStep = "details" | "custom-price" | "payment" | "delivery" | "rights";
type ProductStep = QuickStep | CustomizeStep;
type ProductFlow = "quick" | "customize";

const CUSTOMIZE_STEPS: readonly CustomizeStep[] = [
  "details",
  "custom-price",
  "payment",
  "delivery",
  "rights",
];

function defaultTrigger(editing: boolean): ReactElement {
  return (
    <button
      type="button"
      className="sk-press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
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

function projectOptionLabel(project: PrivateOfferProjectOption): string {
  return project.title;
}

async function uploadAgreementPdfBytes(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  });
  if (!response.ok) throw new Error("The PDF upload did not finish. Try again.");
}

function stepForError(error: PrivateOfferDraftError): ProductStep {
  if (error.step === "recipient") return "recipient";
  if (error.step === "price") return "custom-price";
  if (error.step === "review") return "rights";
  return error.step;
}

export function ProductPrivateOfferComposer({
  recipients,
  taxMode,
  taxRatePct,
  defaultCurrency,
  templateProduct,
  initialOffer,
  open: controlledOpen,
  onOpenChange,
  onCreated,
  trigger,
  returnFocusRef,
}: {
  recipients: PrivateOfferComposerRecipient[];
  taxMode: TaxMode;
  taxRatePct: number;
  defaultCurrency: PrivateOfferCurrency;
  templateProduct?: PrivateOfferTemplateProduct;
  initialOffer?: PrivateOfferComposerInitialOffer;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (sent: PrivateOfferSentSummary) => void;
  trigger?: ReactElement | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const editing = Boolean(initialOffer);
  const lockedClientId = initialOffer?.clientContactId;
  const sourceName =
    templateProduct?.source.productName ??
    initialOffer?.sourceProductName ??
    initialOffer?.terms.name ??
    "Store product";
  const sourceKind = templateProduct?.source.productKind ?? initialOffer?.terms.service ?? "other";
  const sourceProductId = templateProduct?.source.productId ?? initialOffer?.productId;
  const seededDraft = useMemo(
    () =>
      seedPrivateOfferDraft({
        defaultCurrency,
        taxMode,
        taxRatePct,
        ...(initialOffer ? { initialOffer } : {}),
        ...(templateProduct ? { templateProduct } : {}),
      }),
    [defaultCurrency, initialOffer, taxMode, taxRatePct, templateProduct],
  );
  const { toast } = useToast();
  const online = useOnlineStatus();
  const router = useRouter();
  const idPrefix = useId().replace(/:/g, "");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [flow, setFlow] = useState<ProductFlow>("quick");
  const [step, setStep] = useState<ProductStep>(editing ? "price" : "recipient");
  const [draft, setDraft] = useState(seededDraft);
  const [reviewValue, setReviewValue] = useState<PrivateOfferReviewDraft | null>(null);
  const [invalidField, setInvalidField] = useState<PrivateOfferDraftField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [customized, setCustomized] = useState(false);
  const [pdfUploadPending, setPdfUploadPending] = useState(false);
  const [agreementPdfUploadToken, setAgreementPdfUploadToken] = useState<string | null>(null);
  const [agreementPdfPreviewUrl, setAgreementPdfPreviewUrl] = useState<string | null>(null);
  const [submissionOfferId, setSubmissionOfferId] = useState<string | null>(null);
  const [projectOptions, setProjectOptions] = useState<readonly PrivateOfferProjectOption[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectRetryKey, setProjectRetryKey] = useState(0);
  const previousOpenRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const projectRequestRef = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);

  const selectedClientId =
    lockedClientId ?? (draft.recipientKind === "existing" ? draft.clientContactId : "");
  const selectedRecipient = recipients.find((recipient) => recipient.id === selectedClientId);
  const editRecipient = initialOffer
    ? {
        id: initialOffer.clientContactId,
        name: initialOffer.recipientName ?? selectedRecipient?.name ?? "Selected client",
        email: initialOffer.recipientEmail ?? selectedRecipient?.email ?? "",
        projects: [],
      }
    : null;
  const editorRecipients = editRecipient
    ? [...recipients.filter((recipient) => recipient.id !== editRecipient.id), editRecipient]
    : recipients;
  const activeRecipient = editorRecipients.find((recipient) => recipient.id === selectedClientId);
  const availableProjects = projectOptions.map((project) => ({
    id: project.id,
    title: project.title,
    label: projectOptionLabel(project),
  }));
  const selectedProject = projectOptions.find((project) => project.id === draft.targetProjectId);

  function resetComposer() {
    setFlow("quick");
    setStep(editing ? "price" : "recipient");
    setDraft(seededDraft);
    setReviewValue(null);
    setInvalidField(null);
    setError(null);
    setPending(false);
    setDirty(false);
    setConfirmClose(false);
    setCustomized(false);
    setPdfUploadPending(false);
    setAgreementPdfUploadToken(null);
    setAgreementPdfPreviewUrl(null);
    setSubmissionOfferId(null);
    setProjectOptions([]);
    setProjectsStatus("idle");
    setProjectsError(null);
    setProjectRetryKey(0);
    submitInFlightRef.current = false;
  }

  useEffect(() => {
    if (open && !previousOpenRef.current) resetComposer();
    previousOpenRef.current = open;
  }, [open, seededDraft]);

  useEffect(() => {
    return () => {
      if (agreementPdfPreviewUrl) URL.revokeObjectURL(agreementPdfPreviewUrl);
    };
  }, [agreementPdfPreviewUrl]);

  useEffect(() => {
    if (!open || !selectedClientId || draft.recipientKind === "new") {
      setProjectOptions([]);
      setProjectsStatus("idle");
      setProjectsError(null);
      return;
    }
    const request = ++projectRequestRef.current;
    if (!online) {
      setProjectsStatus("error");
      setProjectsError("Reconnect to load this client's projects.");
      return;
    }
    setProjectsStatus("loading");
    setProjectsError(null);
    void loadPrivateOfferProjectOptionsAction(selectedClientId)
      .then((result) => {
        if (request !== projectRequestRef.current) return;
        if (!result.ok) {
          setProjectOptions([]);
          setProjectsStatus("error");
          setProjectsError(result.error);
          return;
        }
        setProjectOptions(result.data);
        setProjectsStatus("ready");
      })
      .catch(() => {
        if (request !== projectRequestRef.current) return;
        setProjectOptions([]);
        setProjectsStatus("error");
        setProjectsError("Could not load this client's projects. Try again.");
      });
  }, [draft.recipientKind, online, open, projectRetryKey, selectedClientId]);

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
      errorRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [error, invalidField, open, step]);

  function patch(next: Partial<PrivateOfferComposerDraft>) {
    if (pending || submitInFlightRef.current) return;
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
    setError(null);
    setInvalidField(null);
  }

  function showError(validationError: PrivateOfferDraftError) {
    setError(validationError.message);
    setInvalidField(validationError.field);
  }

  function move(next: ProductStep) {
    setStep(next);
    setError(null);
    setInvalidField(null);
    setDirty(true);
  }

  function retryProjects() {
    setProjectsStatus("idle");
    setProjectsError(null);
    projectRequestRef.current += 1;
    setProjectOptions([]);
    setProjectRetryKey((current) => current + 1);
  }

  function closeNow() {
    const token = agreementPdfUploadToken;
    if (token) void cancelAgreementPdfUpload({ uploadToken: token });
    resetComposer();
    if (controlledOpen === undefined) setUncontrolledOpen(false);
    onOpenChange?.(false);
  }

  function finishAndClose() {
    setAgreementPdfUploadToken(null);
    setDirty(false);
    resetComposer();
    if (controlledOpen === undefined) setUncontrolledOpen(false);
    onOpenChange?.(false);
  }

  function requestOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      if (controlledOpen === undefined) setUncontrolledOpen(true);
      onOpenChange?.(true);
      return;
    }
    if (pending || submitInFlightRef.current) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeNow();
  }

  function enterCustomize(target: CustomizeStep = "details") {
    setFlow("customize");
    setStep(target);
    setDirty(true);
    setError(null);
    setInvalidField(null);
  }

  function validateReview(): PrivateOfferReviewDraft | null {
    const result = validatePrivateOfferReviewDraft(draft, lockedClientId, availableProjects);
    if ("error" in result) {
      showError(result.error);
      if (result.error.step === "recipient") {
        setFlow("quick");
        setStep("recipient");
      } else if (result.error.step !== "price") {
        setFlow("customize");
        setStep(stepForError(result.error));
      }
      return null;
    }
    setReviewValue(result.value);
    return result.value;
  }

  function handleContinue() {
    if (pending) return;
    if (flow === "quick") {
      if (step === "recipient") {
        const result = validatePrivateOfferStep(
          "recipient",
          draft,
          lockedClientId,
          availableProjects,
        );
        if ("error" in result) {
          showError(result.error);
          return;
        }
        move("price");
        return;
      }
      if (step === "price") {
        if (!validateReview()) return;
        move("review");
      }
      return;
    }

    const currentIndex = CUSTOMIZE_STEPS.indexOf(step as CustomizeStep);
    const validationStep = step === "custom-price" ? "price" : step;
    const result = validatePrivateOfferStep(
      validationStep,
      draft,
      lockedClientId,
      availableProjects,
    );
    if ("error" in result) {
      showError(result.error);
      return;
    }
    const next = CUSTOMIZE_STEPS[currentIndex + 1];
    if (next) move(next);
  }

  function handleBack() {
    if (pending) return;
    if (flow === "customize") {
      const index = CUSTOMIZE_STEPS.indexOf(step as CustomizeStep);
      if (index === 0) {
        setFlow("quick");
        setStep("price");
        return;
      }
      const previous = CUSTOMIZE_STEPS[index - 1];
      if (previous) move(previous);
      return;
    }
    if (step === "review" || step === "price")
      move(editing || step === "review" ? "price" : "recipient");
  }

  function saveCustomizations() {
    if (!validateReview()) return;
    setCustomized(true);
    setFlow("quick");
    setStep("price");
  }

  async function handleAgreementPdfSelect(file: File) {
    const fileError = agreementPdfFileError({
      originalFileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (fileError) {
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
      if (!prepared.ok) throw new Error(prepared.error);
      try {
        await uploadAgreementPdfBytes(prepared.data.uploadUrl, file);
      } catch (uploadError) {
        await cancelAgreementPdfUpload({ uploadToken: prepared.data.uploadToken });
        throw uploadError;
      }
      if (previousToken) void cancelAgreementPdfUpload({ uploadToken: previousToken });
      setAgreementPdfUploadToken(prepared.data.uploadToken);
      setAgreementPdfPreviewUrl(URL.createObjectURL(file));
      patch({
        agreementMode: "pdf",
        agreementPdf: {
          documentId: null,
          originalFileName: file.name,
          sizeBytes: file.size,
        },
        agreementText: "",
        agreementNeedsCompletion: false,
      });
    } catch (uploadError) {
      toast(
        uploadError instanceof Error ? uploadError.message : "Could not upload the PDF. Try again.",
        "error",
      );
    } finally {
      setPdfUploadPending(false);
    }
  }

  function removeAgreementPdf() {
    if (agreementPdfUploadToken) {
      void cancelAgreementPdfUpload({ uploadToken: agreementPdfUploadToken });
      setAgreementPdfUploadToken(null);
    }
    setAgreementPdfPreviewUrl(null);
    patch({ agreementMode: "none", agreementPdf: null, agreementText: "" });
  }

  function agreementPdfPayload(): PrivateOfferAgreementPdfPayload | undefined {
    if (draft.agreementMode !== "pdf") return { kind: "remove" };
    if (agreementPdfUploadToken) {
      return { kind: "replace", uploadToken: agreementPdfUploadToken };
    }
    const documentId = draft.agreementPdf?.documentId;
    if (!documentId) return undefined;
    return editing ? { kind: "keep", documentId } : { kind: "inherit", documentId };
  }

  function handleSubmit() {
    if (pending || submitInFlightRef.current) return;
    if (!online) {
      setError(
        editing ? "Reconnect to save this private offer." : "Reconnect to send this private offer.",
      );
      return;
    }
    const result = validatePrivateOfferDraft(draft, lockedClientId, availableProjects);
    if ("error" in result) {
      showError(result.error);
      if (result.error.step === "recipient") {
        setFlow("quick");
        setStep("recipient");
      } else if (result.error.step !== "review") {
        setFlow("customize");
        setStep(stepForError(result.error));
      }
      return;
    }
    const pdfPayload = agreementPdfPayload();
    if (draft.agreementMode === "pdf" && !pdfPayload) {
      setFlow("customize");
      setStep("rights");
      setError("The agreement PDF is unavailable. Replace it or explicitly remove it.");
      return;
    }
    const value = result.value;
    const offerId = initialOffer?.id ?? submissionOfferId ?? crypto.randomUUID();
    if (!initialOffer && !submissionOfferId) setSubmissionOfferId(offerId);
    submitInFlightRef.current = true;
    setPending(true);
    void (async () => {
      try {
        const actionResult = initialOffer
          ? await updatePrivateOfferAction({
              offerId: initialOffer.id,
              expectedUpdatedAt: initialOffer.expectedUpdatedAt,
              recipient: { kind: "existing", clientContactId: initialOffer.clientContactId },
              target: value.recipient.target,
              terms: value.terms,
              ...(pdfPayload ? { agreementPdf: pdfPayload } : {}),
              expiresAt: value.expiry.toISOString(),
            })
          : await sendPrivateOfferAction({
              offerId,
              ...(sourceProductId ? { sourceProductId } : {}),
              recipient: value.recipient.recipient,
              target: value.recipient.target,
              terms: value.terms,
              ...(pdfPayload ? { agreementPdf: pdfPayload } : {}),
              expiresAt: value.expiry.toISOString(),
            });
        if (!actionResult.ok) {
          submitInFlightRef.current = false;
          setPending(false);
          setError(actionResult.error);
          toast(actionResult.error, "error");
          return;
        }
        const recipientEmail = privateOfferRecipientEmail(
          draft,
          initialOffer?.recipientEmail,
          recipients,
        );
        if (!editing && onCreated) {
          // The share surface reports the outcome, including a failed email.
        } else if (actionResult.data.emailDelivered === false) {
          toast("Offer saved, but the email wasn’t delivered.", "info");
        } else if (editing) {
          toast(
            "changed" in actionResult.data && actionResult.data.changed
              ? "Private offer updated."
              : "No changes to save.",
            "success",
          );
        } else {
          toast(`Private offer sent to ${recipientEmail}.`, "success");
        }
        if (!editing) {
          const sentRecipient = value.recipient.recipient;
          const knownRecipient =
            sentRecipient.kind === "existing"
              ? editorRecipients.find((recipient) => recipient.id === sentRecipient.clientContactId)
              : undefined;
          onCreated?.({
            offerId: actionResult.data.id,
            offerName: value.terms.name,
            recipientName:
              sentRecipient.kind === "new"
                ? sentRecipient.name
                : (knownRecipient?.name ?? "your client"),
            recipientEmail:
              recipientEmail || (sentRecipient.kind === "new" ? sentRecipient.email : ""),
            emailDelivered: actionResult.data.emailDelivered,
          });
        }
        finishAndClose();
        if (editing || !onCreated) router.refresh();
      } catch {
        submitInFlightRef.current = false;
        setPending(false);
        const message = editing
          ? "The offer couldn’t be updated. Try again."
          : "The offer couldn’t be sent. Try again.";
        setError(message);
        toast(message, "error");
      }
    })();
  }

  const projectProps = {
    projects: availableProjects,
    projectsStatus,
    ...(projectsError ? { projectsError } : {}),
    onRetryProjects: retryProjects,
    onInteraction: () => {
      setDirty(true);
    },
  };

  let body: React.ReactNode;
  if (flow === "quick" && step === "recipient") {
    body = (
      <PrivateOfferRecipientStep
        idPrefix={idPrefix}
        draft={draft}
        recipients={editorRecipients}
        {...projectProps}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (flow === "quick" && step === "price") {
    body = (
      <PrivateOfferCompactPriceStep
        idPrefix={idPrefix}
        draft={draft}
        sourceName={sourceName}
        sourceKind={sourceKind}
        invalidField={invalidField}
        patch={patch}
        customized={customized}
        onCustomize={() => {
          enterCustomize();
        }}
        {...(editing ? { editProject: projectProps } : {})}
      />
    );
  } else if (flow === "customize" && step === "details") {
    body = (
      <PrivateOfferDetailsStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (flow === "customize" && step === "custom-price") {
    body = (
      <PrivateOfferPriceStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (flow === "customize" && step === "payment") {
    body = <PrivateOfferPaymentStep draft={draft} invalidField={invalidField} patch={patch} />;
  } else if (flow === "customize" && step === "delivery") {
    body = (
      <PrivateOfferDeliveryStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
      />
    );
  } else if (flow === "customize" && step === "rights") {
    body = (
      <PrivateOfferRightsStep
        idPrefix={idPrefix}
        draft={draft}
        invalidField={invalidField}
        patch={patch}
        enablePdfAgreement
        pdfUploadPending={pdfUploadPending}
        onAgreementPdfSelect={(file) => void handleAgreementPdfSelect(file)}
        onAgreementPdfRemove={removeAgreementPdf}
      />
    );
  } else {
    const review = reviewValue
      ? { value: reviewValue }
      : validatePrivateOfferReviewDraft(draft, lockedClientId, availableProjects);
    const value = "value" in review ? review.value : null;
    const recipientName =
      initialOffer?.recipientName ??
      (draft.recipientKind === "new" ? draft.newRecipientName.trim() : activeRecipient?.name) ??
      "Selected client";
    const recipientEmail = privateOfferRecipientEmail(
      draft,
      initialOffer?.recipientEmail,
      recipients,
    );
    const documentId = draft.agreementPdf?.documentId;
    const agreementHref = documentId
      ? `/api/agreement-pdfs/evidence?${new URLSearchParams(
          editing
            ? { offerId: initialOffer?.id ?? "", documentId }
            : { productId: sourceProductId ?? "", documentId },
        ).toString()}`
      : (agreementPdfPreviewUrl ?? undefined);
    body = value ? (
      <ProductPrivateOfferReview
        snapshot={value.snapshot}
        targetLabel={
          value.recipient.target.kind === "new"
            ? "Create a new project"
            : (selectedProject?.title ?? "Existing project")
        }
        recipientName={recipientName}
        recipientEmail={recipientEmail}
        expiresAtLocal={draft.expiresAtLocal}
        sourceTemplateName={sourceName}
        sourceTemplateKind={sourceKind}
        agreementPdfPreview={draft.agreementPdf}
        {...(agreementHref ? { agreementHref } : {})}
      />
    ) : null;
  }

  const customizeIndex = flow === "customize" ? CUSTOMIZE_STEPS.indexOf(step as CustomizeStep) : -1;
  const isCustomizeLast = flow === "customize" && step === "rights";
  const isReview = flow === "quick" && step === "review";
  const isFirst =
    flow === "customize" ? customizeIndex === 0 : editing ? step === "price" : step === "recipient";
  const title = isReview
    ? editing
      ? "Review changes"
      : "Review private offer"
    : flow === "customize"
      ? step === "details"
        ? "Product details"
        : step === "custom-price"
          ? "Price"
          : step === "payment"
            ? "Payment options"
            : step === "delivery"
              ? "Delivery"
              : "Rights & agreement"
      : editing
        ? "Edit private offer"
        : step === "recipient"
          ? "Recipient"
          : "Price & terms";
  const subtitle =
    editing && !isReview
      ? `Editing offer for ${initialOffer?.recipientName ?? activeRecipient?.name ?? "Selected client"} · ${initialOffer?.recipientEmail ?? activeRecipient?.email ?? ""}`
      : undefined;
  const shellTrigger = trigger === null ? null : (trigger ?? defaultTrigger(editing));

  return (
    <>
      <EditorShell
        open={open}
        onOpenChange={requestOpenChange}
        trigger={shellTrigger}
        {...(returnFocusRef ? { returnFocusRef } : {})}
        mode={editing ? "edit" : "new"}
        productName={sourceName}
        steps={flow === "customize" ? CUSTOMIZE_STEPS : ["recipient", "price"]}
        current={step}
        title={title}
        {...(subtitle ? { subtitle } : {})}
        canContinue={!pending && !pdfUploadPending}
        onBack={handleBack}
        onContinue={handleContinue}
        onSave={handleSubmit}
        onPublish={handleSubmit}
        onSaveHidden={handleSubmit}
        onDiscard={requestOpenChange.bind(null, false)}
        isLastStep={isReview || isCustomizeLast}
        isFirstStep={isFirst}
        pending={pending}
        pendingAction={editing ? "edit" : "publish"}
        editorLabel={editing ? "Edit private offer" : "Send a private offer"}
        stepLabel={
          isReview
            ? editing
              ? "REVIEW CHANGES"
              : "REVIEW PRIVATE OFFER"
            : flow === "customize"
              ? `CUSTOMIZE · ${String(customizeIndex + 1)} OF ${String(CUSTOMIZE_STEPS.length)}`
              : "PRIVATE OFFER"
        }
        progressLabel="Private offer setup progress"
        progressContent={
          flow === "quick" && !editing && !isReview ? (
            <PrivateOfferTopProgress
              current={step === "recipient" ? "recipient" : "price"}
              sourceName={sourceName}
              sourceKind={sourceKind}
              onSelect={(next) => {
                if (next === "recipient" || step === "price") move(next);
              }}
            />
          ) : flow === "quick" ? null : undefined
        }
        closeLabel="Close private offer editor"
        backLabel={isReview ? "Edit offer" : "← Back"}
        continueLabel={flow === "quick" && step === "price" ? "Review offer →" : "Continue →"}
        finalNote={null}
        showDiscard={false}
        {...(isCustomizeLast
          ? {
              finalActions: [
                {
                  label: "Save customizations",
                  onClick: saveCustomizations,
                  variant: "primary" as const,
                },
              ],
            }
          : isReview
            ? {
                finalActions: [
                  {
                    label: editing ? "Save changes" : "Send private offer →",
                    pendingLabel: editing ? "Saving…" : "Sending…",
                    onClick: handleSubmit,
                    disabled: pdfUploadPending,
                    variant: "primary" as const,
                  },
                ],
              }
            : {})}
      >
        {error ? (
          <div
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="mb-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.07)] px-3 py-2.5 text-[12.5px] font-medium text-[rgb(var(--fg-danger))]"
          >
            {error}
          </div>
        ) : null}
        {body}
        {confirmClose ? (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
            role="presentation"
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${idPrefix}-close-title`}
              aria-describedby={`${idPrefix}-close-description`}
              className="w-full max-w-sm rounded-[var(--radius-xl)] bg-[rgb(var(--bg-elevated))] p-5 shadow-2xl"
            >
              <h2
                id={`${idPrefix}-close-title`}
                className="font-display text-[20px] font-extrabold"
              >
                Close this offer?
              </h2>
              <p
                id={`${idPrefix}-close-description`}
                className="mt-2 text-[13px] text-[rgb(var(--fg-muted))]"
              >
                Your changes will be lost.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  autoFocus
                  type="button"
                  onClick={() => {
                    setConfirmClose(false);
                  }}
                  className="sk-press min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[13px] font-semibold"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={closeNow}
                  className="sk-press min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3 text-[13px] font-semibold text-[rgb(var(--bg-elevated))]"
                >
                  Close offer
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </EditorShell>
    </>
  );
}
