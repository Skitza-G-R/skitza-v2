"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, FileText, HandCoins, ImageUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  cancelManualReceiptAction,
  presignManualReceiptAction,
  recordManualPaymentAction,
  type ManualReceiptContentType,
} from "~/app/(producer)/dashboard/clients-projects/actions";
import { uploadPaymentProofBytes } from "~/components/artist/purchase/proof-upload-lifecycle";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

import {
  BLOCKED_STATE_LABELS,
  centsToInput,
  composePaymentNote,
  defaultPaymentSelection,
  formatFileSize,
  formatMoney,
  isFileDrag,
  listRecordablePayments,
  PAYMENT_METHODS,
  paidAtIsoFromDate,
  parseAmountToCents,
  successMessage,
  todayIsoDate,
  validateAmount,
  validateReceiptFile,
  type PaymentMethod,
  type RecordablePayment,
  type RecordablePaymentState,
} from "./record-payment-model";

// SK-260 — "Record a payment". A centered dialog on desktop, a bottom sheet
// on phones (`.sk-sheet-mobile`). One installment per record; the amount is
// prefilled with what is left and may be partial. The receipt is optional and
// goes presign → direct PUT → finalize inside the record call, so a failed
// upload never leaves a half-written payment behind.

export interface RecordPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  purchases: readonly ProjectPurchaseSummary[];
  /** A receipt dropped onto the tab before the dialog opened. */
  initialFile?: File | null | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}

type Phase = "idle" | "uploading" | "recording";

interface ReceiptDraft {
  file: File;
  contentType: ManualReceiptContentType;
  previewUrl: string | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf,.pdf";

function newOperationKey(): string {
  return crypto.randomUUID();
}

function formatDueDate(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return `Due ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date)}`;
}

function optionSubLabel(payment: RecordablePayment): string {
  if (payment.state === "open") return formatDueDate(payment.dueAtIso);
  // SK-293 — selectable, so it names what it is waiting for rather than
  // reading as a refusal like the blocked states below.
  if (payment.state === "needs_milestone") return "Waiting on approval";
  return BLOCKED_STATE_LABELS[payment.state];
}

function isSelectable(state: RecordablePaymentState): boolean {
  return state === "open" || state === "needs_milestone";
}

function draftFromFile(file: File): ReceiptDraft | { error: string } {
  const checked = validateReceiptFile(file);
  if (!checked.ok) return { error: checked.error };
  const previewUrl =
    checked.contentType === "application/pdf" || checked.contentType === "image/heic"
      ? null
      : URL.createObjectURL(file);
  return { file, contentType: checked.contentType, previewUrl };
}

export function RecordPaymentDialog({
  open,
  onClose,
  projectId,
  purchases,
  initialFile = null,
  returnFocusRef,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const baseId = useId();

  const payments = useMemo(() => listRecordablePayments(purchases), [purchases]);
  // The dialog is mounted only while open, so initial state comes straight
  // from props and there is nothing to reset between uses.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    defaultPaymentSelection(payments),
  );
  const [amount, setAmount] = useState(() => {
    const initial = payments.find((payment) => payment.id === defaultPaymentSelection(payments));
    return initial ? centsToInput(initial.remainingCents) : "";
  });
  const [date, setDate] = useState(() => todayIsoDate());
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<ReceiptDraft | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const operationKeyRef = useRef<string>(newOperationKey());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const selected: RecordablePayment | null = useMemo(
    () => payments.find((payment) => payment.id === selectedId) ?? null,
    [payments, selectedId],
  );

  // A changed field means a different command — never replay the old key.
  const touchKey = useCallback(() => {
    operationKeyRef.current = newOperationKey();
  }, []);

  // The live draft also lives in a ref so the unmount cleanup can revoke the
  // preview URL without re-subscribing on every change.
  const receiptRef = useRef<ReceiptDraft | null>(null);
  const applyFile = useCallback(
    (file: File | null) => {
      if (receiptRef.current?.previewUrl) URL.revokeObjectURL(receiptRef.current.previewUrl);
      receiptRef.current = null;
      if (!file) {
        setReceipt(null);
        setReceiptError(null);
        touchKey();
        return;
      }
      const draft = draftFromFile(file);
      if ("error" in draft) {
        setReceipt(null);
        setReceiptError(draft.error);
        return;
      }
      receiptRef.current = draft;
      setReceipt(draft);
      setReceiptError(null);
      touchKey();
    },
    [touchKey],
  );

  useEffect(() => {
    if (initialFile) applyFile(initialFile);
    // Mount-only: a receipt dropped on the tab is attached once.
  }, [initialFile, applyFile]);

  useEffect(
    () => () => {
      if (receiptRef.current?.previewUrl) URL.revokeObjectURL(receiptRef.current.previewUrl);
    },
    [],
  );

  const amountCents = parseAmountToCents(amount);
  const amountError = selected
    ? validateAmount(amountCents, selected.remainingCents, selected.currency)
    : "Pick which payment this is for.";
  const paidAtIso = paidAtIsoFromDate(date);
  const dateError = paidAtIso ? null : "Pick a date that is not in the future.";
  const busy = phase !== "idle";
  const canSubmit = !busy && selected !== null && amountError === null && dateError === null;

  const selectPayment = (payment: RecordablePayment) => {
    if (!isSelectable(payment.state)) return;
    setSelectedId(payment.id);
    if (!amountTouched) setAmount(centsToInput(payment.remainingCents));
    touchKey();
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    applyFile(file);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = event.dataTransfer.files[0] ?? null;
    applyFile(file);
  };

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAmountTouched(true);
    if (!selected || amountCents === null || amountError || !paidAtIso) {
      amountRef.current?.focus();
      return;
    }
    if (!online) {
      toast("Reconnect to record this payment.", "error");
      return;
    }

    const operationKey = operationKeyRef.current;
    let uploadToken: string | undefined;
    try {
      if (receipt) {
        setPhase("uploading");
        setUploadPercent(0);
        const presigned = await presignManualReceiptAction({
          purchaseId: selected.purchaseId,
          installmentId: selected.installmentId,
          operationKey,
          fileName: receipt.file.name,
          contentType: receipt.contentType,
          sizeBytes: receipt.file.size,
          ...(selected.state === "needs_milestone" ? { markFinalMilestone: true } : {}),
        });
        if (!presigned.ok) {
          toast(presigned.error, "error");
          setPhase("idle");
          return;
        }
        uploadToken = presigned.data.uploadToken;
        const controller = new AbortController();
        const uploaded = await uploadPaymentProofBytes({
          uploadUrl: presigned.data.uploadUrl,
          file: receipt.file,
          contentType: receipt.contentType,
          signal: controller.signal,
          onProgress: (loaded, total) => {
            setUploadPercent(total > 0 ? Math.round((loaded / total) * 100) : 0);
          },
        });
        if (!uploaded.ok) {
          void cancelManualReceiptAction({
            purchaseId: selected.purchaseId,
            installmentId: selected.installmentId,
            uploadToken,
          });
          toast("The receipt upload did not finish. Check your connection and try again.", "error");
          setPhase("idle");
          return;
        }
      }

      setPhase("recording");
      const noteValue = composePaymentNote(method, note);
      const result = await recordManualPaymentAction({
        projectId,
        purchaseId: selected.purchaseId,
        installmentId: selected.installmentId,
        operationKey,
        amountCents,
        paidAtIso,
        ...(noteValue ? { note: noteValue } : {}),
        ...(uploadToken ? { uploadToken } : {}),
        ...(selected.state === "needs_milestone" ? { markFinalMilestone: true } : {}),
      });
      if (!result.ok) {
        toast(result.error, "error");
        setPhase("idle");
        return;
      }
      toast(successMessage(result.data), "success");
      router.refresh();
      onClose();
    } catch {
      toast("Could not record this payment. Try again.", "error");
      setPhase("idle");
    }
  };

  const submitLabel =
    phase === "uploading"
      ? `Uploading receipt… ${String(uploadPercent)}%`
      : phase === "recording"
        ? "Recording…"
        : selected && amountCents !== null && amountError === null
          ? `Record ${formatMoney(amountCents, selected.currency)}`
          : "Record payment";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            amountRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-xl)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)] sm:p-6"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))] sm:inline-flex"
            >
              <HandCoins size={20} strokeWidth={2.1} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:text-[19px]">
                Record a payment
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                Money you received outside Skitza — cash, bank transfer, Bit.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={busy}
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>

          <form
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
            className="mt-5 space-y-5"
            noValidate
          >
            <fieldset disabled={busy} className="min-w-0 space-y-5">
              {/* 1 — which payment */}
              <section aria-labelledby={`${baseId}-which`}>
                <h3
                  id={`${baseId}-which`}
                  className="text-[11px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase"
                >
                  Which payment?
                </h3>
                {payments.length === 0 ? (
                  <p className="mt-2 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] px-3 py-4 text-center text-[12.5px] text-[rgb(var(--fg-muted))]">
                    Nothing is waiting for payment on this project.
                  </p>
                ) : (
                  <div
                    role="radiogroup"
                    aria-labelledby={`${baseId}-which`}
                    className="mt-2 space-y-2"
                  >
                    {payments.map((payment) => {
                      const isSelected = payment.id === selectedId;
                      const blocked = !isSelectable(payment.state);
                      return (
                        <button
                          key={payment.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          aria-disabled={blocked || undefined}
                          onClick={() => {
                            selectPayment(payment);
                          }}
                          className={[
                            "sk-press grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-lg)] border px-3.5 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
                            blocked
                              ? "cursor-not-allowed border-[rgb(var(--border-subtle))] bg-[rgb(var(--fg-default)/0.025)] opacity-70"
                              : isSelected
                                ? "border-[rgb(var(--brand-primary)/0.55)] bg-[rgb(var(--brand-primary)/0.09)] shadow-[inset_0_0_0_1px_rgb(var(--brand-primary)/0.35)]"
                                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--fg-default)/0.22)]",
                          ].join(" ")}
                        >
                          <span
                            aria-hidden
                            className={[
                              "inline-flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                              isSelected
                                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
                                : "border-[rgb(var(--fg-default)/0.3)]",
                            ].join(" ")}
                          >
                            {isSelected ? <Check size={12} strokeWidth={3} /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-bold text-[rgb(var(--fg-default))]">
                              {payment.purchaseLabel}
                            </span>
                            <span className="mt-0.5 block text-[11.5px] text-[rgb(var(--fg-muted))]">
                              Payment {payment.position} of {payment.installmentCount}
                              {" · "}
                              {optionSubLabel(payment)}
                            </span>
                          </span>
                          <span className="text-right">
                            <span className="block font-mono text-[13px] font-bold text-[rgb(var(--fg-default))] tabular-nums">
                              {formatMoney(payment.remainingCents, payment.currency)}
                            </span>
                            <span className="block text-[10px] font-bold tracking-wide text-[rgb(var(--fg-muted))] uppercase">
                              left
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selected?.state === "needs_milestone" ? (
                  <p className="mt-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.22)] bg-[rgb(var(--fg-warning)/0.08)] px-3.5 py-3 text-[12px] leading-relaxed text-[rgb(var(--fg-warning-text))]">
                    This one normally waits for your client to approve the final version in Skitza.
                    Recording it marks the work finished, so the payment stops waiting.
                  </p>
                ) : null}
              </section>

              {/* 2 — amount + date */}
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <div>
                  <label
                    htmlFor={`${baseId}-amount`}
                    className="text-[12px] font-semibold text-[rgb(var(--fg-default))]"
                  >
                    Amount received
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      ref={amountRef}
                      id={`${baseId}-amount`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      aria-invalid={amountTouched && amountError !== null ? true : undefined}
                      aria-describedby={`${baseId}-amount-hint`}
                      onChange={(event) => {
                        setAmount(event.target.value);
                        setAmountTouched(true);
                        touchKey();
                      }}
                      className="min-h-12 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] pr-24 pl-3 font-mono text-[18px] font-bold text-[rgb(var(--fg-default))] tabular-nums focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[10.5px] font-bold tracking-wide text-[rgb(var(--fg-muted))] uppercase">
                      {selected?.currency ?? ""}
                    </span>
                    {selected && amountCents !== selected.remainingCents ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAmount(centsToInput(selected.remainingCents));
                          setAmountTouched(true);
                          touchKey();
                        }}
                        className="sk-press absolute top-1/2 right-12 -translate-y-1/2 rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.12)] px-2 py-1 text-[10.5px] font-bold text-[rgb(var(--brand-primary-dark))] hover:bg-[rgb(var(--brand-primary)/0.2)]"
                      >
                        Full
                      </button>
                    ) : null}
                  </div>
                  <p
                    id={`${baseId}-amount-hint`}
                    className={[
                      "mt-1 text-[11.5px]",
                      amountTouched && amountError
                        ? "text-[rgb(var(--fg-danger-text))]"
                        : "text-[rgb(var(--fg-muted))]",
                    ].join(" ")}
                  >
                    {amountTouched && amountError
                      ? amountError
                      : selected
                        ? `${formatMoney(selected.remainingCents, selected.currency)} left on this payment. Partial amounts are fine.`
                        : "Pick a payment above first."}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor={`${baseId}-date`}
                    className="text-[12px] font-semibold text-[rgb(var(--fg-default))]"
                  >
                    Date received
                  </label>
                  <input
                    id={`${baseId}-date`}
                    type="date"
                    value={date}
                    max={todayIsoDate()}
                    aria-invalid={dateError ? true : undefined}
                    onChange={(event) => {
                      setDate(event.target.value);
                      touchKey();
                    }}
                    className="mt-1.5 min-h-12 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[14px]"
                  />
                  {dateError ? (
                    <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-danger-text))]">
                      {dateError}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* 3 — how they paid */}
              <div>
                <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                  How they paid{" "}
                  <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
                </p>
                <div
                  className="mt-1.5 flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Payment method"
                >
                  {PAYMENT_METHODS.map((entry) => {
                    const active = method === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setMethod(active ? null : entry.id);
                          touchKey();
                        }}
                        className={[
                          "sk-press inline-flex min-h-9 items-center rounded-[var(--radius-md)] border px-3 text-[12.5px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
                          active
                            ? "border-[rgb(var(--fg-default))] bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-background))]"
                            : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--fg-default)/0.3)]",
                        ].join(" ")}
                      >
                        {entry.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  id={`${baseId}-note`}
                  value={note}
                  maxLength={500}
                  autoComplete="off"
                  placeholder="Note — e.g. transfer ref 8841"
                  aria-label="Note"
                  onChange={(event) => {
                    setNote(event.target.value);
                    touchKey();
                  }}
                  className="mt-2 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[13.5px]"
                />
              </div>

              {/* 4 — receipt */}
              <div>
                <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                  Receipt{" "}
                  <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  aria-label="Choose a receipt file"
                  onChange={handleFileInput}
                />
                {receipt ? (
                  <div className="mt-1.5 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.25)] bg-[rgb(var(--fg-success)/0.06)] p-2.5">
                    {receipt.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={receipt.previewUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-[var(--radius-md)] object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--fg-default)/0.06)] text-[rgb(var(--fg-default))]"
                      >
                        <FileText size={20} strokeWidth={2} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                        {receipt.file.name}
                      </span>
                      <span className="block text-[11.5px] text-[rgb(var(--fg-muted))]">
                        {formatFileSize(receipt.file.size)} · stored privately
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label="Remove receipt"
                      onClick={() => {
                        applyFile(null);
                      }}
                      className="sk-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
                    >
                      <X size={15} strokeWidth={2.2} aria-hidden />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => {
                      if (!isFileDrag(event.dataTransfer.types)) return;
                      event.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => {
                      setDragOver(false);
                    }}
                    onDrop={handleDrop}
                    data-dragging={dragOver || undefined}
                    className={[
                      "sk-press mt-1.5 flex min-h-[72px] w-full items-center gap-3 rounded-[var(--radius-lg)] border border-dashed px-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
                      dragOver
                        ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.1)]"
                        : "border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--brand-primary)/0.04)] hover:bg-[rgb(var(--brand-primary)/0.08)]",
                    ].join(" ")}
                  >
                    <span
                      aria-hidden
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]"
                    >
                      <ImageUp size={18} strokeWidth={2.1} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-[rgb(var(--fg-default))]">
                        Add the receipt
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-[rgb(var(--fg-muted))]">
                        <span className="hidden sm:inline">
                          Drop a photo or PDF here, or click to choose.
                        </span>
                        <span className="sm:hidden">Photo or PDF from your phone.</span>
                      </span>
                    </span>
                  </button>
                )}
                {receiptError ? (
                  <p className="mt-1 text-[11.5px] text-[rgb(var(--fg-danger-text))]">
                    {receiptError}
                  </p>
                ) : null}
              </div>
            </fieldset>

            {/* footer */}
            <div className="border-t border-[rgb(var(--border-subtle))] pt-4">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="sk-press inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[14px] font-bold text-[rgb(var(--fg-on-brand))] shadow-[0_8px_20px_-8px_rgb(var(--brand-primary)/0.7)] transition-opacity disabled:opacity-45 disabled:shadow-none"
                >
                  <Check size={16} strokeWidth={2.6} aria-hidden />
                  {submitLabel}
                </button>
              </div>
              <p className="mt-3 text-center text-[11.5px] text-[rgb(var(--fg-muted))] sm:text-right">
                Your client will see this as a confirmed payment.
              </p>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
