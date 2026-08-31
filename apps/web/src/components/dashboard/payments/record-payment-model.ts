import type { ManualReceiptContentType } from "~/app/(producer)/dashboard/clients-projects/actions";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";

// SK-260 — pure view model behind the "Record a payment" form. Everything
// that decides *what* the producer may record lives here so it can be tested
// without React: which installments are offered, which are blocked and why,
// amount parsing, receipt validation, and the note that lands in the ledger.

export type RecordablePaymentState =
  | "open"
  /**
   * SK-293 — a 50/50 final half waiting on an artist approval that never
   * happened in Skitza. Selectable, but recording it also declares the work
   * finished, so the form says so before the producer commits.
   */
  | "needs_milestone"
  | "not_due"
  | "proof_pending"
  | "purchase_canceled";

export interface RecordablePayment {
  id: string;
  purchaseId: string;
  installmentId: string;
  purchaseLabel: string;
  position: number;
  installmentCount: number;
  currency: string;
  remainingCents: number;
  dueAtIso: string | null;
  state: RecordablePaymentState;
}

export const BLOCKED_STATE_LABELS: Readonly<
  Record<Exclude<RecordablePaymentState, "open" | "needs_milestone">, string>
> = {
  not_due: "Not due yet",
  proof_pending: "Proof waiting for review",
  purchase_canceled: "Purchase canceled",
};

const SETTLED_STATUSES = new Set(["confirmed", "waived", "canceled"]);

/**
 * Every installment that is not already settled, in purchase order. Settled
 * installments are dropped (there is nothing to record); blocked ones are kept
 * so the producer can see *why* a payment is not selectable.
 */
export function listRecordablePayments(
  purchases: readonly ProjectPurchaseSummary[],
): RecordablePayment[] {
  const result: RecordablePayment[] = [];
  for (const purchase of purchases) {
    const ordered = [...purchase.installments].sort(
      (left, right) => left.position - right.position,
    );
    for (const installment of ordered) {
      if (SETTLED_STATUSES.has(installment.status)) continue;
      if (installment.remainingCents <= 0) continue;
      const state: RecordablePaymentState =
        purchase.lifecycleStatus === "canceled"
          ? "purchase_canceled"
          : installment.hasPendingProof || installment.status === "awaiting_review"
            ? "proof_pending"
            : installment.payableNow
              ? "open"
              : installment.finalMilestonePending
                ? "needs_milestone"
                : "not_due";
      result.push({
        id: installment.id,
        purchaseId: purchase.id,
        installmentId: installment.id,
        purchaseLabel: purchase.sourceLabel,
        position: installment.position,
        installmentCount: purchase.installments.length,
        currency: installment.currency,
        remainingCents: installment.remainingCents,
        dueAtIso: installment.dueAtIso,
        state,
      });
    }
  }
  return result;
}

export function openPayments(list: readonly RecordablePayment[]): RecordablePayment[] {
  return list.filter((payment) => payment.state === "open");
}

/**
 * Everything the producer may actually record against — money that is due, plus
 * a final half they can settle by declaring the milestone themselves (SK-293).
 */
export function selectablePayments(list: readonly RecordablePayment[]): RecordablePayment[] {
  return list.filter((payment) => payment.state === "open" || payment.state === "needs_milestone");
}

/** Pre-select only when the choice is unambiguous. */
export function defaultPaymentSelection(list: readonly RecordablePayment[]): string | null {
  const selectable = selectablePayments(list);
  return selectable.length === 1 ? (selectable[0]?.id ?? null) : null;
}

export interface RecordableSummary {
  openCount: number;
  /**
   * SK-293 — final halves that are not due, but that the producer may settle
   * by declaring the work finished. Counted apart from `openCount` so a healthy
   * in-flight project still reads as "nothing due" rather than being pushed to
   * collect early.
   */
  milestoneCount: number;
  /** Remaining cents per currency across open installments. */
  remainingByCurrency: readonly { currency: string; cents: number }[];
  /** The same totals for halves held back by a missing approval. */
  milestoneByCurrency: readonly { currency: string; cents: number }[];
}

function totalsByCurrency(
  list: readonly RecordablePayment[],
): { currency: string; cents: number }[] {
  const totals = new Map<string, number>();
  for (const payment of list) {
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + payment.remainingCents);
  }
  return [...totals.entries()].map(([currency, cents]) => ({ currency, cents }));
}

export function summarizeRecordable(list: readonly RecordablePayment[]): RecordableSummary {
  const open = openPayments(list);
  const milestone = list.filter((payment) => payment.state === "needs_milestone");
  return {
    openCount: open.length,
    milestoneCount: milestone.length,
    remainingByCurrency: totalsByCurrency(open),
    milestoneByCurrency: totalsByCurrency(milestone),
  };
}

/** "1,250" / "1250.50" / "₪ 300" → cents; null when it is not a plain amount. */
export function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  if (!cleaned || !/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export type AmountHintTone = "prompt" | "remainder" | "settled";

export interface AmountHint {
  tone: AmountHintTone;
  text: string;
}

/**
 * The line under the amount field. Until a usable amount is typed it orients
 * the producer with the balance they are recording against; from the first
 * digit on it answers the question they actually have — what this payment
 * leaves behind. `cents` is null while the field is untouched, empty, or not
 * yet a plain amount, and an over-payment falls back to the prompt because
 * `validateAmount` already owns that message.
 */
export function amountHint(
  cents: number | null,
  remainingCents: number,
  currency: string,
): AmountHint {
  if (cents === null || cents <= 0 || cents > remainingCents) {
    return {
      tone: "prompt",
      text: `${formatMoney(remainingCents, currency)} left. Partial amounts are fine.`,
    };
  }
  const afterCents = remainingCents - cents;
  if (afterCents === 0) return { tone: "settled", text: "Nothing left after this." };
  return { tone: "remainder", text: `${formatMoney(afterCents, currency)} left after this.` };
}

export function validateAmount(
  cents: number | null,
  remainingCents: number,
  currency: string,
): string | null {
  if (cents === null) return "Enter the amount you received.";
  if (cents <= 0) return "The amount must be above zero.";
  if (cents > remainingCents) {
    return `That is more than what is left (${formatMoney(remainingCents, currency)}).`;
  }
  return null;
}

export type PaymentMethod = "cash" | "bank_transfer" | "bit" | "paypal" | "other";

export const PAYMENT_METHODS: readonly { id: PaymentMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "bit", label: "Bit" },
  { id: "paypal", label: "PayPal" },
  { id: "other", label: "Other" },
];

/** Method and note share the ledger's single `note` column: "Bank transfer — ref 8841". */
export function composePaymentNote(method: PaymentMethod | null, note: string): string | undefined {
  const label = method ? PAYMENT_METHODS.find((entry) => entry.id === method)?.label : undefined;
  const cleanNote = note.trim();
  if (label && cleanNote) return `${label} — ${cleanNote}`;
  if (label) return label;
  if (cleanNote) return cleanNote;
  return undefined;
}

export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

const RECEIPT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

const EXTENSION_TYPES: Readonly<Record<string, ManualReceiptContentType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
};

/** Browsers often report an empty type for HEIC; fall back to the extension. */
export function receiptContentType(file: {
  name: string;
  type: string;
}): ManualReceiptContentType | null {
  const declared = file.type.toLowerCase();
  if (RECEIPT_TYPES.has(declared)) return declared as ManualReceiptContentType;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_TYPES[extension] ?? null;
}

export function validateReceiptFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true; contentType: ManualReceiptContentType } | { ok: false; error: string } {
  const contentType = receiptContentType(file);
  if (!contentType) {
    return { ok: false, error: "Receipts can be a photo (JPG, PNG, WEBP, HEIC) or a PDF." };
  }
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_RECEIPT_BYTES) {
    return { ok: false, error: "Receipts must be 15 MB or smaller." };
  }
  return { ok: true, contentType };
}

export function isFileDrag(types: readonly string[] | DOMStringList | undefined): boolean {
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes("Files");
}

export function todayIsoDate(now = new Date()): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A yyyy-mm-dd date picked by the producer → ISO at local noon, never in the future. */
export function paidAtIsoFromDate(date: string, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const picked = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
  if (Number.isNaN(picked.getTime())) return null;
  if (picked.getTime() > now.getTime()) {
    // Today at noon can be "in the future" in the morning; clamp to now.
    if (date === todayIsoDate(now)) return now.toISOString();
    return null;
  }
  return picked.toISOString();
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function successMessage(input: {
  installmentPosition: number;
  installmentStatus: string;
  paidInFull: boolean;
}): string {
  if (input.paidInFull) return "Payment recorded — this purchase is paid in full.";
  if (input.installmentStatus === "confirmed") {
    return `Payment recorded — payment ${String(input.installmentPosition)} is paid.`;
  }
  if (input.installmentStatus === "partially_paid") {
    return `Payment recorded — payment ${String(input.installmentPosition)} is partially paid.`;
  }
  return "Payment recorded.";
}
