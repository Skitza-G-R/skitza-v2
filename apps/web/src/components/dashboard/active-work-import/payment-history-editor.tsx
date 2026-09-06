"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleArrowUp,
  CircleDashed,
  FileUp,
  LockKeyhole,
  Minus,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  centsToInput,
  draftInstallmentSchedule,
  draftPaymentBalance,
  draftTaxBreakdown,
  formatImportMoney,
  inputToCents,
  localDateInputValue,
  type ActiveWorkImportDraft,
  type ImportPaymentDraft,
  type ImportPlanKind,
} from "./model";

const FIELD_CLASS =
  "sk-native-field min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:min-h-10 sm:rounded-[var(--radius-md)] sm:text-[13px]";

export type ProofUploadView = Readonly<{
  status: "uploading" | "done" | "error";
  error: string | null;
}>;

type DraftInstallment = ReturnType<typeof draftInstallmentSchedule>[number];

type ActivePaymentEditor = Readonly<{
  paymentOperationKey: string;
  installmentPosition: number;
  seed: ImportPaymentDraft;
}>;

type EditorError = Readonly<{
  field: "amount" | "date" | "payment";
  message: string;
}>;

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
      {children}
    </label>
  );
}

function scheduleLabel(position: number, trigger: DraftInstallment["trigger"]): string {
  if (trigger === "artist_approval") return `Payment ${String(position)} · after Artist approval`;
  if (trigger === "monthly_anniversary") return `Payment ${String(position)} · monthly`;
  return `Payment ${String(position)} · starts now`;
}

function isRealReceivedDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > localDateInputValue()) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isPaymentFullyRecorded(payment: ImportPaymentDraft): boolean {
  const amountCents = inputToCents(payment.amount);
  return amountCents !== null && amountCents > 0 && isRealReceivedDate(payment.paidAt);
}

function paymentDateLabel(value: string): string {
  if (!isRealReceivedDate(value)) return "Date required";
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function receivedForInstallment(
  payments: readonly ImportPaymentDraft[],
  installmentPosition: number,
): number {
  return payments
    .filter((payment) => payment.installmentPosition === installmentPosition)
    .reduce((sum, payment) => sum + (inputToCents(payment.amount) ?? 0), 0);
}

function remainingForInstallment(
  installment: DraftInstallment,
  payments: readonly ImportPaymentDraft[],
): number {
  return Math.max(
    0,
    installment.amountCents - receivedForInstallment(payments, installment.position),
  );
}

function installmentState(
  installment: DraftInstallment,
  payments: readonly ImportPaymentDraft[],
): "Paid" | "Partial" | "Overpaid" | "Not paid" | "Locked" | "Needs info" {
  if (installment.trigger === "artist_approval") return "Locked";
  if (
    payments.some(
      (payment) =>
        payment.installmentPosition === installment.position && !isPaymentFullyRecorded(payment),
    )
  ) {
    return "Needs info";
  }
  const received = receivedForInstallment(payments, installment.position);
  if (received > installment.amountCents) return "Overpaid";
  if (received === installment.amountCents) return "Paid";
  if (received > 0) return "Partial";
  return "Not paid";
}

type InstallmentState = ReturnType<typeof installmentState>;

// SK-308: every state gets an icon and a colour so the row reads at a glance
// without the English word: green check = paid, amber = something to finish,
// muted = nothing yet, lock = waits for the Artist.
const STATE_CHIP: Record<InstallmentState, Readonly<{ Icon: LucideIcon; className: string }>> = {
  Paid: {
    Icon: Check,
    className: "bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]",
  },
  Partial: {
    Icon: CircleDashed,
    className: "bg-[rgb(var(--fg-warning)/0.12)] text-[rgb(var(--fg-warning-text))]",
  },
  "Needs info": {
    Icon: CircleAlert,
    className: "bg-[rgb(var(--fg-warning)/0.12)] text-[rgb(var(--fg-warning-text))]",
  },
  Overpaid: {
    Icon: CircleArrowUp,
    className: "bg-[rgb(var(--fg-warning)/0.12)] text-[rgb(var(--fg-warning-text))]",
  },
  "Not paid": {
    Icon: Circle,
    className: "bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))]",
  },
  Locked: {
    Icon: LockKeyhole,
    className: "bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-muted))]",
  },
};

function StatusChip({ state }: { state: InstallmentState }) {
  const { Icon, className } = STATE_CHIP[state];
  return (
    <span
      data-installment-state={state}
      className={`inline-flex min-h-6 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-[10.5px] font-bold whitespace-nowrap ${className}`}
    >
      <Icon size={12} strokeWidth={2.4} aria-hidden />
      {state}
    </span>
  );
}

const PLAN_OPTIONS = [
  ["full", "Full"],
  ["split_50_50", "50/50"],
  ["monthly", "Monthly"],
] as const;

function planBlocks(draft: ActiveWorkImportDraft, kind: ImportPlanKind): number {
  if (kind === "full") return 1;
  if (kind === "split_50_50") return 2;
  return monthlyCount(draft);
}

function firstIncompletePayment(
  payments: readonly ImportPaymentDraft[],
  schedule: readonly DraftInstallment[],
): ImportPaymentDraft | null {
  for (const installment of schedule) {
    if (installment.trigger === "artist_approval") continue;
    const incomplete = payments.find(
      (payment) =>
        payment.installmentPosition === installment.position && !isPaymentFullyRecorded(payment),
    );
    if (incomplete) return incomplete;
  }
  return null;
}

function editorForPayment(payment: ImportPaymentDraft): ActivePaymentEditor {
  return {
    paymentOperationKey: payment.operationKey,
    installmentPosition: payment.installmentPosition,
    seed: { ...payment },
  };
}

function monthlyCount(draft: ActiveWorkImportDraft): number {
  const parsed = Number.parseInt(draft.agreement.monthlyInstallments, 10);
  return Number.isFinite(parsed) ? Math.max(2, Math.min(12, parsed)) : 2;
}

function planSummary(draft: ActiveWorkImportDraft, schedule: readonly DraftInstallment[]): string {
  if (draft.agreement.planKind === "split_50_50") return "50/50 · 2 payments";
  if (draft.agreement.planKind === "monthly") {
    return `Monthly · ${String(schedule.length || monthlyCount(draft))} payments`;
  }
  return "Full · 1 payment";
}

export function PaymentHistoryEditor({
  draft,
  operationKey,
  proofUploads,
  onChange,
  onUploadProof,
  onEditingChange,
}: {
  draft: ActiveWorkImportDraft;
  operationKey: string;
  proofUploads: Readonly<Record<string, ProofUploadView>>;
  onChange: (draft: ActiveWorkImportDraft) => void;
  onUploadProof: (paymentOperationKey: string, file: File) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const schedule = draftInstallmentSchedule(draft);
  const totalCents = draftTaxBreakdown(draft).totalCents;
  const balance = draftPaymentBalance(draft);
  const importedPaidCents = balance.paidCents;
  const remainingCents = balance.remainingCents ?? 0;
  // Share of the scheduled total that is settled. Overpayment never pushes
  // this past 100 because remaining is per installment, floored at zero.
  const progressPct =
    totalCents !== null && totalCents > 0 && balance.remainingCents !== null
      ? Math.round(Math.max(0, Math.min(1, (totalCents - remainingCents) / totalCents)) * 100)
      : 0;
  const currency = draft.agreement.currency || "USD";
  const blockingIncomplete = firstIncompletePayment(draft.payments, schedule);
  const [activeEditor, setActiveEditor] = useState<ActivePaymentEditor | null>(() =>
    blockingIncomplete ? editorForPayment(blockingIncomplete) : null,
  );
  const [editorError, setEditorError] = useState<EditorError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planHistoryWarning, setPlanHistoryWarning] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(() => Boolean(blockingIncomplete?.note.trim()));
  const editorActionsRef = useRef<HTMLDivElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const editingChangeRef = useRef(onEditingChange);

  const persistedActivePayment = activeEditor
    ? (draft.payments.find(
        (payment) => payment.operationKey === activeEditor.paymentOperationKey,
      ) ?? null)
    : null;
  const activePayment = persistedActivePayment ?? activeEditor?.seed ?? null;
  const activeInstallment = activeEditor
    ? (schedule.find((installment) => installment.position === activeEditor.installmentPosition) ??
      null)
    : null;
  const activeUpload = activeEditor ? proofUploads[activeEditor.paymentOperationKey] : undefined;
  const editorErrorId = activeEditor
    ? `import-payment-error-${activeEditor.paymentOperationKey}`
    : undefined;
  const editing = activeEditor !== null;

  useEffect(() => {
    editingChangeRef.current = onEditingChange;
  }, [onEditingChange]);

  useEffect(() => {
    editingChangeRef.current?.(editing);
  }, [editing]);

  useEffect(
    () => () => {
      editingChangeRef.current?.(false);
    },
    [],
  );

  useEffect(() => {
    const incomplete = firstIncompletePayment(draft.payments, schedule);
    setActiveEditor(incomplete ? editorForPayment(incomplete) : null);
    setEditorError(null);
    setNotice(null);
    setPlanHistoryWarning(null);
    setNoteOpen(Boolean(incomplete?.note.trim()));
    // A row switch is the only time this editor resets itself from persisted data.
  }, [operationKey]);

  useEffect(() => {
    if (!activeEditor) return;
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    amountInputRef.current?.focus({ preventScroll: true });
    if (typeof editorActionsRef.current?.scrollIntoView === "function") {
      editorActionsRef.current.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [activeEditor?.paymentOperationKey]);

  function patchAgreement(patch: Partial<ActiveWorkImportDraft["agreement"]>) {
    onChange({
      ...draft,
      agreement: { ...draft.agreement, ...patch },
      payments: draft.payments,
    });
  }

  function approvePlanChange(): boolean {
    if (draft.payments.length === 0) return true;
    const approved = window.confirm(
      "This item already has payment history. Changing the plan will keep every payment on its current installment. Review the result before finishing.",
    );
    if (approved) {
      setPlanHistoryWarning(
        "Payment history was kept on its original installments. Review any Needs info before finishing.",
      );
    }
    return approved;
  }

  function changePlan(planKind: ImportPlanKind) {
    if (draft.agreement.planKind === planKind || !approvePlanChange()) return;
    patchAgreement({ planKind });
    setActiveEditor(null);
    setEditorError(null);
    setNotice(null);
  }

  function changeMonthlyCount(delta: -1 | 1) {
    const next = Math.max(2, Math.min(12, monthlyCount(draft) + delta));
    if (next === monthlyCount(draft) || !approvePlanChange()) return;
    patchAgreement({ monthlyInstallments: String(next) });
    setActiveEditor(null);
    setEditorError(null);
    setNotice(null);
  }

  function earliestOpenInstallment(
    payments: readonly ImportPaymentDraft[] = draft.payments,
  ): DraftInstallment | null {
    const incomplete = firstIncompletePayment(payments, schedule);
    if (incomplete) {
      return (
        schedule.find((installment) => installment.position === incomplete.installmentPosition) ??
        null
      );
    }
    return (
      schedule.find(
        (installment) =>
          installment.trigger !== "artist_approval" &&
          remainingForInstallment(installment, payments) > 0,
      ) ?? null
    );
  }

  function showEditor(editor: ActivePaymentEditor) {
    setActiveEditor(editor);
    setEditorError(null);
    setNotice(null);
    setNoteOpen(Boolean(editor.seed.note.trim()));
  }

  function openNewPayment(
    installment: DraftInstallment,
    payments: readonly ImportPaymentDraft[] = draft.payments,
  ) {
    if (installment.trigger === "artist_approval") return;
    const remaining = remainingForInstallment(installment, payments);
    if (remaining <= 0) {
      const latest = [...payments]
        .reverse()
        .find((payment) => payment.installmentPosition === installment.position);
      if (latest) showEditor(editorForPayment(latest));
      return;
    }
    const paymentOperationKey = `active-work-import-payment:${crypto.randomUUID()}`;
    showEditor({
      paymentOperationKey,
      installmentPosition: installment.position,
      seed: {
        operationKey: paymentOperationKey,
        installmentPosition: installment.position,
        amount: centsToInput(remaining),
        paidAt: "",
        note: "",
        proofUploadToken: null,
        proofFileName: null,
      },
    });
  }

  function openInstallment(installment: DraftInstallment) {
    if (installment.trigger === "artist_approval") return;
    const incomplete = draft.payments.find(
      (payment) =>
        payment.installmentPosition === installment.position && !isPaymentFullyRecorded(payment),
    );
    if (incomplete) {
      showEditor(editorForPayment(incomplete));
      return;
    }
    if (remainingForInstallment(installment, draft.payments) > 0) {
      openNewPayment(installment);
      return;
    }
    const latest = [...draft.payments]
      .reverse()
      .find((payment) => payment.installmentPosition === installment.position);
    if (latest) showEditor(editorForPayment(latest));
  }

  function updateActivePayment(patch: Partial<ImportPaymentDraft>) {
    if (!activeEditor || !activePayment) return;
    const nextPayment = {
      ...activePayment,
      ...patch,
      operationKey: activeEditor.paymentOperationKey,
    };
    const existing = draft.payments.some(
      (payment) => payment.operationKey === activeEditor.paymentOperationKey,
    );
    const nextPayments = existing
      ? draft.payments.map((payment) =>
          payment.operationKey === activeEditor.paymentOperationKey ? nextPayment : payment,
        )
      : [...draft.payments, nextPayment];
    setActiveEditor({ ...activeEditor, seed: nextPayment });
    onChange({ ...draft, payments: nextPayments });
  }

  function removeActivePayment() {
    if (!activeEditor) return;
    const nextPayments = draft.payments.filter(
      (payment) => payment.operationKey !== activeEditor.paymentOperationKey,
    );
    onChange({ ...draft, payments: nextPayments });
    setActiveEditor(null);
    setEditorError(null);
    setNotice("Payment removed from this draft.");
    setNoteOpen(false);
  }

  function saveActivePayment() {
    if (!activeEditor || !activePayment || !activeInstallment) return;
    const amountCents = inputToCents(activePayment.amount);
    if (amountCents === null || amountCents <= 0) {
      setEditorError({ field: "amount", message: "Add the real amount received." });
      amountInputRef.current?.focus();
      return;
    }
    if (!isRealReceivedDate(activePayment.paidAt)) {
      setEditorError({
        field: "date",
        message: "Add the real date received. A future date cannot be used.",
      });
      return;
    }
    if (activeInstallment.trigger === "artist_approval") {
      setEditorError({
        field: "payment",
        message: "The final 50% stays locked until the Artist approves the final version.",
      });
      return;
    }

    const savedPayment = {
      ...activePayment,
      operationKey: activeEditor.paymentOperationKey,
      installmentPosition: activeInstallment.position,
    };
    const alreadyPersisted = draft.payments.some(
      (payment) => payment.operationKey === activeEditor.paymentOperationKey,
    );
    const nextPayments = alreadyPersisted
      ? draft.payments.map((payment) =>
          payment.operationKey === activeEditor.paymentOperationKey ? savedPayment : payment,
        )
      : [...draft.payments, savedPayment];
    if (!alreadyPersisted) onChange({ ...draft, payments: nextPayments });

    const currentRemaining = remainingForInstallment(activeInstallment, nextPayments);
    const nextInstallment = schedule.find(
      (installment) =>
        installment.trigger !== "artist_approval" &&
        remainingForInstallment(installment, nextPayments) > 0,
    );

    if (currentRemaining > 0) {
      openNewPayment(activeInstallment, nextPayments);
      setNotice(
        `Payment ${String(activeInstallment.position)} saved. Add the remaining ${formatImportMoney(currentRemaining, currency)}.`,
      );
      return;
    }
    if (nextInstallment) {
      openNewPayment(nextInstallment, nextPayments);
      setNotice(
        `Payment ${String(activeInstallment.position)} saved. Payment ${String(nextInstallment.position)} is ready.`,
      );
      return;
    }

    setActiveEditor(null);
    setEditorError(null);
    setNoteOpen(false);
    setNotice(
      draft.agreement.planKind === "split_50_50"
        ? `Payment ${String(activeInstallment.position)} saved. Final 50% stays locked until Artist approval.`
        : `Payment ${String(activeInstallment.position)} saved.`,
    );
  }

  function proofFileSelected(file: File) {
    if (!activeEditor) return;
    updateActivePayment({ proofFileName: file.name });
    onUploadProof(activeEditor.paymentOperationKey, file);
  }

  return (
    <section data-active-import-step="Payments" className="min-w-0 py-1">
      <header className="mb-3 border-b border-[rgb(var(--border-subtle))] pb-3">
        <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
          Step 3 of 3
        </p>
        <h2 className="mt-1 text-[19px] font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          Payments
        </h2>
        <p className="mt-0.5 max-w-[58ch] text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Record only money already received. The date is required and is never guessed.
        </p>
      </header>

      <div className="min-w-0 space-y-3">
        <div className="min-w-0 space-y-2 border-b border-[rgb(var(--border-subtle))] pb-3">
          <div role="group" aria-label="Agreed payment plan" className="grid min-w-0 grid-cols-3 gap-2">
            {PLAN_OPTIONS.map(([kind, label]) => {
              const selected = draft.agreement.planKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    changePlan(kind);
                  }}
                  className={`sk-press flex min-h-11 min-w-0 flex-col justify-between gap-2 rounded-[var(--radius-lg)] border p-2.5 text-left transition-colors duration-150 motion-reduce:transition-none sm:p-3 ${
                    selected
                      ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.09)] text-[rgb(var(--fg-default))]"
                      : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))]"
                  }`}
                >
                  <span aria-hidden data-plan-split className="flex h-2 w-full gap-0.5">
                    {Array.from({ length: planBlocks(draft, kind) }, (_, index) => (
                      <span
                        key={index}
                        className={`h-full min-w-0 flex-1 rounded-[2px] ${
                          selected
                            ? "bg-[rgb(var(--brand-primary))]"
                            : "bg-[rgb(var(--fg-faint))]"
                        }`}
                      />
                    ))}
                  </span>
                  <span className="text-[12px] font-bold">{label}</span>
                </button>
              );
            })}
          </div>

          {draft.agreement.planKind === "monthly" ? (
            <div className="flex min-w-0 items-center justify-between gap-3">
              <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                Monthly payments
              </p>
              <div
                role="group"
                aria-label="Monthly payment count controls"
                className="flex min-h-11 items-center justify-between rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-0.5 sm:min-h-9 sm:rounded-[var(--radius-md)]"
              >
                <button
                  type="button"
                  aria-label="Use one fewer monthly payment"
                  disabled={monthlyCount(draft) <= 2}
                  onClick={() => {
                    changeMonthlyCount(-1);
                  }}
                  className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] disabled:opacity-30 sm:h-9 sm:w-9"
                >
                  <Minus size={14} strokeWidth={2.3} aria-hidden />
                </button>
                <output
                  aria-label="Monthly payment count"
                  className="font-amount min-w-6 text-center text-[14px] font-bold text-[rgb(var(--fg-default))]"
                >
                  {String(monthlyCount(draft))}
                </output>
                <button
                  type="button"
                  aria-label="Use one more monthly payment"
                  disabled={monthlyCount(draft) >= 12}
                  onClick={() => {
                    changeMonthlyCount(1);
                  }}
                  className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] disabled:opacity-30 sm:h-9 sm:w-9"
                >
                  <Plus size={14} strokeWidth={2.3} aria-hidden />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-1.5 border-b border-[rgb(var(--border-subtle))] pb-3 sm:max-w-[19rem]">
          <Label htmlFor={`import-first-payment-due-${operationKey}`}>
            First payment due{" "}
            <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
          </Label>
          <input
            id={`import-first-payment-due-${operationKey}`}
            type="date"
            value={draft.agreement.firstPaymentDueAt}
            aria-describedby={`import-first-payment-due-hint-${operationKey}`}
            onChange={(event) => {
              patchAgreement({ firstPaymentDueAt: event.target.value });
            }}
            className={FIELD_CLASS}
          />
          <p
            id={`import-first-payment-due-hint-${operationKey}`}
            className="text-[10.5px] leading-relaxed text-[rgb(var(--fg-muted))]"
          >
            {draft.agreement.planKind === "monthly"
              ? "Leave it empty to use the day you add this. Every later monthly payment counts forward from this date."
              : "Leave it empty to use the day you add this."}
          </p>
        </div>

        <div
          data-payment-summary
          className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 py-2.5 sm:px-4 sm:py-3"
        >
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <p className="truncate text-[12px] font-bold text-[rgb(var(--fg-default))]">
              {planSummary(draft, schedule)}
            </p>
            <p className="shrink-0 text-[10px] text-[rgb(var(--fg-muted))]">Confirmed by producer</p>
          </div>
          <dl data-payment-summary-metrics className="mt-2 grid grid-cols-3 gap-2">
            {[
              ["Total", totalCents === null ? "—" : formatImportMoney(totalCents, currency)],
              ["Paid", formatImportMoney(importedPaidCents, currency)],
              [
                "Remaining",
                totalCents === null ? "—" : formatImportMoney(remainingCents, currency),
              ],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  {label}
                </dt>
                <dd className="font-amount mt-0.5 truncate text-[14px] font-bold text-[rgb(var(--fg-default))] sm:text-[15px]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div
            role="progressbar"
            aria-label="Paid so far"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[rgb(var(--border-subtle))]"
          >
            <div
              className="h-full rounded-[var(--radius-sm)] bg-[rgb(var(--fg-success))] transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${String(progressPct)}%` }}
            />
          </div>
        </div>

        {planHistoryWarning ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.07)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[rgb(var(--fg-warning-text))]"
          >
            <CircleAlert size={14} strokeWidth={2.2} aria-hidden className="mt-0.5 shrink-0" />
            {planHistoryWarning}
          </p>
        ) : null}

        {balance.overpaidCents > 0 ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.07)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[rgb(var(--fg-warning-text))]">
            <CircleAlert size={14} strokeWidth={2.2} aria-hidden className="mt-0.5 shrink-0" />
            This purchase is overpaid by {formatImportMoney(balance.overpaidCents, currency)}. The
            excess stays on this purchase.
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.24)] bg-[rgb(var(--fg-success)/0.07)] px-3 py-2.5 text-[11.5px] text-[rgb(var(--fg-success-text))]"
          >
            <Check size={14} strokeWidth={2.4} aria-hidden className="shrink-0" />
            {notice}
          </p>
        ) : null}

        {schedule.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.25)] bg-[rgb(var(--fg-warning)/0.07)] p-3 text-[12px] text-[rgb(var(--fg-warning-text))]">
            Add a valid agreement price to see the payment plan.
          </p>
        ) : (
          <div
            role="list"
            aria-label="Installment schedule"
            className="min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))]"
          >
            {schedule.map((installment) => {
              const payments = draft.payments.filter(
                (payment) => payment.installmentPosition === installment.position,
              );
              const received = receivedForInstallment(draft.payments, installment.position);
              const dates = payments.map((payment) => payment.paidAt).filter(Boolean);
              const state = installmentState(installment, draft.payments);
              const locked = installment.trigger === "artist_approval";
              const active = activeEditor?.installmentPosition === installment.position;
              const editorPayment = activePayment as ImportPaymentDraft;
              const earliest = earliestOpenInstallment();
              const hasIncomplete = payments.some((payment) => !isPaymentFullyRecorded(payment));
              const blockedByIncomplete = Boolean(
                blockingIncomplete && installment.position > blockingIncomplete.installmentPosition,
              );
              const canRecord =
                !locked && !blockedByIncomplete && earliest?.position === installment.position;
              const latest = payments.at(-1) ?? null;
              const receivedLine =
                received > 0
                  ? `${formatImportMoney(received, currency)} received · ${
                      dates.length === 1
                        ? paymentDateLabel(dates[0] ?? "")
                        : dates.length > 1
                          ? `${String(dates.length)} dates`
                          : "no date"
                    }`
                  : null;
              const action = locked ? null : active ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveEditor(null);
                    setEditorError(null);
                  }}
                  className="sk-press inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-lg)] px-2 text-[11.5px] font-semibold text-[rgb(var(--fg-muted))]"
                >
                  Close <ChevronUp size={13} strokeWidth={2.2} aria-hidden />
                </button>
              ) : hasIncomplete || canRecord || latest ? (
                <button
                  type="button"
                  onClick={() => {
                    openInstallment(installment);
                  }}
                  disabled={
                    blockedByIncomplete ||
                    (!hasIncomplete && !canRecord && state !== "Paid" && state !== "Overpaid")
                  }
                  className="sk-press inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 text-[11.5px] font-bold text-[rgb(var(--fg-default))] disabled:cursor-not-allowed disabled:border-transparent disabled:text-[rgb(var(--fg-faint))]"
                >
                  {blockedByIncomplete ? (
                    "Waiting"
                  ) : hasIncomplete ? (
                    "Continue"
                  ) : canRecord ? (
                    <>
                      <Plus size={13} strokeWidth={2.4} aria-hidden />
                      {"Add payment"}
                    </>
                  ) : state === "Paid" || state === "Overpaid" ? (
                    "Edit"
                  ) : (
                    "Waiting"
                  )}
                  {blockedByIncomplete || hasIncomplete || (!canRecord && state !== "Paid" && state !== "Overpaid") ? null : (
                    <ChevronDown size={13} strokeWidth={2.2} aria-hidden />
                  )}
                </button>
              ) : null;
              return (
                <article
                  role="listitem"
                  key={installment.position}
                  className="min-w-0 border-t border-[rgb(var(--border-subtle))] first:border-t-0"
                >
                  <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-4">
                    <span
                      aria-hidden
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-mono text-[10px] font-bold ${
                        locked
                          ? "bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-faint))]"
                          : "bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-elevated))]"
                      }`}
                    >
                      {String(installment.position).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`font-amount text-[16px] leading-tight font-bold tracking-[-0.02em] ${
                          locked ? "text-[rgb(var(--fg-muted))]" : "text-[rgb(var(--fg-default))]"
                        }`}
                      >
                        {formatImportMoney(installment.amountCents, currency)}
                      </p>
                      <p className="mt-0.5 truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
                        {scheduleLabel(installment.position, installment.trigger)}
                      </p>
                      {locked ? (
                        <p className="mt-0.5 text-[10.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
                          Final 50% starts after Artist approval.
                        </p>
                      ) : null}
                      {receivedLine ? (
                        <p className="font-amount mt-0.5 truncate text-[11px] font-semibold text-[rgb(var(--fg-secondary))]">
                          {receivedLine}
                        </p>
                      ) : null}
                    </div>
                    <div className="justify-self-end">
                      <StatusChip state={state} />
                    </div>
                    {action ? (
                      <div className="col-span-3 flex justify-end sm:col-span-1">{action}</div>
                    ) : null}
                  </div>

                  {active ? (
                    <div
                      role="group"
                      aria-label={`Edit Payment ${String(installment.position)}`}
                      data-payment-inline-editor={activeEditor.paymentOperationKey}
                      className="min-w-0 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--brand-primary)/0.045)] px-3 py-4 sm:px-4"
                    >
                      {payments.length > 0 ? (
                        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-[10.5px] font-semibold text-[rgb(var(--fg-muted))]">
                            Recorded:
                          </span>
                          {payments.map((payment, paymentIndex) => (
                            <button
                              key={payment.operationKey}
                              type="button"
                              aria-label={`Edit recorded payment ${String(paymentIndex + 1)} for Payment ${String(installment.position)}`}
                              aria-pressed={
                                activeEditor.paymentOperationKey === payment.operationKey
                              }
                              onClick={() => {
                                showEditor(editorForPayment(payment));
                              }}
                              className={`sk-press min-h-8 rounded-[var(--radius-md)] border px-2 text-[10.5px] font-semibold ${
                                activeEditor.paymentOperationKey === payment.operationKey
                                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--fg-default))]"
                                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))]"
                              }`}
                            >
                              {formatImportMoney(inputToCents(payment.amount) ?? 0, currency)} ·{" "}
                              {paymentDateLabel(payment.paidAt)}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`import-payment-amount-${activeEditor.paymentOperationKey}`}
                          >
                            Amount received
                          </Label>
                          <input
                            ref={amountInputRef}
                            id={`import-payment-amount-${activeEditor.paymentOperationKey}`}
                            inputMode="decimal"
                            value={editorPayment.amount}
                            aria-describedby={
                              editorError?.field === "amount" || editorError?.field === "payment"
                                ? editorErrorId
                                : undefined
                            }
                            aria-invalid={
                              editorError?.field === "amount" || editorError?.field === "payment"
                                ? true
                                : undefined
                            }
                            onChange={(event) => {
                              if (editorError?.field === "amount") setEditorError(null);
                              updateActivePayment({ amount: event.target.value });
                            }}
                            className={FIELD_CLASS}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`import-payment-date-${activeEditor.paymentOperationKey}`}
                          >
                            Date received
                          </Label>
                          <input
                            id={`import-payment-date-${activeEditor.paymentOperationKey}`}
                            type="date"
                            max={localDateInputValue()}
                            value={editorPayment.paidAt}
                            aria-describedby={
                              editorError?.field === "date" || editorError?.field === "payment"
                                ? editorErrorId
                                : undefined
                            }
                            aria-invalid={
                              editorError?.field === "date" || editorError?.field === "payment"
                                ? true
                                : undefined
                            }
                            onChange={(event) => {
                              if (editorError?.field === "date") setEditorError(null);
                              updateActivePayment({ paidAt: event.target.value });
                            }}
                            className={FIELD_CLASS}
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                        {!noteOpen && !editorPayment.note.trim() ? (
                          <button
                            type="button"
                            onClick={() => {
                              setNoteOpen(true);
                            }}
                            className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-2 text-[11px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                          >
                            <Plus size={14} strokeWidth={2.2} aria-hidden /> Add note
                          </button>
                        ) : null}
                      </div>

                      {noteOpen || editorPayment.note.trim() ? (
                        <div className="mt-3 space-y-1.5">
                          <Label
                            htmlFor={`import-payment-note-${activeEditor.paymentOperationKey}`}
                          >
                            Note{" "}
                            <span className="font-normal text-[rgb(var(--fg-muted))]">
                              (optional)
                            </span>
                          </Label>
                          <textarea
                            id={`import-payment-note-${activeEditor.paymentOperationKey}`}
                            value={editorPayment.note}
                            maxLength={2_000}
                            rows={2}
                            onChange={(event) => {
                              updateActivePayment({ note: event.target.value });
                            }}
                            placeholder="Bank transfer"
                            className={`${FIELD_CLASS} resize-y py-2.5`}
                          />
                        </div>
                      ) : null}

                      <div className="mt-3">
                        <label
                          data-proof-drop-zone
                          onDragOver={(event) => {
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (activeUpload?.status === "uploading") return;
                            const file = event.dataTransfer.files[0];
                            if (file) proofFileSelected(file);
                          }}
                          className={`flex min-h-[4.5rem] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[var(--radius-lg)] border border-dashed px-4 py-3 text-center transition-colors duration-150 motion-reduce:transition-none ${
                            editorPayment.proofUploadToken
                              ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
                              : "border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] hover:bg-[rgb(var(--bg-overlay))]"
                          }`}
                        >
                          {activeUpload?.status === "uploading" ? (
                            <span className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                              Uploading proof…
                            </span>
                          ) : editorPayment.proofUploadToken ? (
                            <>
                              <span
                                title={editorPayment.proofFileName ?? "Private payment proof"}
                                className="inline-flex max-w-full items-center gap-1.5 text-[12px] font-semibold text-[rgb(var(--fg-default))]"
                              >
                                <FileUp
                                  size={14}
                                  strokeWidth={2.1}
                                  aria-hidden
                                  className="shrink-0 text-[rgb(var(--fg-success-text))]"
                                />
                                <span className="min-w-0 truncate">
                                  {editorPayment.proofFileName ?? "Private payment proof"}
                                </span>
                                <span className="font-normal text-[rgb(var(--fg-muted))]">
                                  · Private
                                </span>
                              </span>
                              <span className="text-[11px] text-[rgb(var(--fg-muted))]">
                                Drop a new file or click to replace it
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                                <FileUp size={14} strokeWidth={2.1} aria-hidden />
                                Drop proof of payment here
                              </span>
                              <span className="text-[11px] text-[rgb(var(--fg-muted))]">
                                or click to choose a file
                              </span>
                              <span className="text-[10.5px] text-[rgb(var(--fg-faint))]">
                                JPG, PNG, HEIC or PDF · up to 15 MB · stays private
                              </span>
                            </>
                          )}
                          <input
                            type="file"
                            className="sr-only"
                            accept="image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf"
                            disabled={activeUpload?.status === "uploading"}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file) proofFileSelected(file);
                            }}
                          />
                        </label>
                        {editorPayment.proofUploadToken && activeUpload?.status !== "uploading" ? (
                          <div className="mt-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                updateActivePayment({
                                  proofUploadToken: null,
                                  proofFileName: null,
                                });
                              }}
                              className="sk-press min-h-11 rounded-[var(--radius-lg)] px-2 text-[11px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                            >
                              Remove proof
                            </button>
                          </div>
                        ) : null}
                        {activeUpload?.status === "error" && activeUpload.error ? (
                          <p
                            role="alert"
                            className="mt-2 text-[11px] leading-relaxed text-[rgb(var(--fg-danger-text))]"
                          >
                            {activeUpload.error}
                          </p>
                        ) : null}
                      </div>

                      {editorError ? (
                        <p
                          id={editorErrorId}
                          role="alert"
                          className="mt-3 text-[11.5px] leading-relaxed text-[rgb(var(--fg-danger-text))]"
                        >
                          {editorError.message}
                        </p>
                      ) : null}

                      <div
                        ref={editorActionsRef}
                        data-payment-editor-actions
                        className="mt-3 flex scroll-mb-6 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end"
                      >
                        {persistedActivePayment ? (
                          <button
                            type="button"
                            onClick={removeActivePayment}
                            disabled={activeUpload?.status === "uploading"}
                            className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-3 text-[11px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-danger-text))] disabled:opacity-40"
                          >
                            <Trash2 size={13} strokeWidth={2.1} aria-hidden /> Remove payment
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={saveActivePayment}
                          disabled={activeUpload?.status === "uploading"}
                          className="sk-press min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[12px] font-bold text-[rgb(var(--fg-on-brand))] disabled:opacity-50"
                        >
                          {activeUpload?.status === "uploading"
                            ? "Uploading proof…"
                            : "Save payment"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        {!activeEditor && earliestOpenInstallment() ? (
          <button
            type="button"
            onClick={() => {
              const installment = earliestOpenInstallment();
              if (installment) openInstallment(installment);
            }}
            className="sk-press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] px-2 text-[11.5px] font-semibold text-[rgb(var(--fg-default))]"
          >
            <Plus size={14} strokeWidth={2.2} aria-hidden />
            {blockingIncomplete
              ? `Continue Payment ${String(blockingIncomplete.installmentPosition)}`
              : draft.payments.length > 0
                ? "Add another payment"
                : "Add first payment"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
