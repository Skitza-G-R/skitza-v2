import type {
  ClientPaymentInstallmentData,
  ClientPaymentProjectData,
  ClientPaymentProofData,
  ClientPaymentPurchaseData,
  ClientPaymentsData,
} from "./client-payments-data";

export interface ClientPaymentCurrencySummary {
  currency: string;
  paidAllTimeCents: number;
  owesNowCents: number;
  expectedThisMonthCents: number;
  waitingOnMilestonesCents: number;
}

export type ClientPaymentPrimaryAction =
  | Readonly<{ kind: "open_proof"; proofId: string }>
  | Readonly<{ kind: "send_reminder" }>
  | Readonly<{ kind: "view_details" }>
  | Readonly<{ kind: "view_record" }>;

export interface ClientPaymentRow {
  id: string;
  project: ClientPaymentProjectData;
  purchase: ClientPaymentPurchaseData;
  installment: ClientPaymentInstallmentData;
  proofs: readonly ClientPaymentProofData[];
  action: ClientPaymentPrimaryAction;
}

export interface ClientPaymentProjectGroup {
  project: ClientPaymentProjectData;
  rows: readonly ClientPaymentRow[];
}

export interface ClientPaymentsView {
  currencySummaries: readonly ClientPaymentCurrencySummary[];
  currentGroups: readonly ClientPaymentProjectGroup[];
  historyGroups: readonly ClientPaymentProjectGroup[];
  hasPayments: boolean;
  noCurrentDebt: boolean;
  allPaid: boolean;
}

function safeTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return value;
  } catch {
    return "UTC";
  }
}

export function clientPaymentLocalDateKey(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function isClosed(installment: ClientPaymentInstallmentData): boolean {
  return (
    installment.remainingCents <= 0 ||
    installment.status === "confirmed" ||
    installment.status === "waived" ||
    installment.status === "canceled"
  );
}

function isDueNow(installment: ClientPaymentInstallmentData, asOfIso: string): boolean {
  if (
    installment.remainingCents <= 0 ||
    installment.status === "confirmed" ||
    installment.status === "waived" ||
    installment.status === "canceled" ||
    installment.status === "awaiting_review"
  ) {
    return false;
  }
  // SK-270: an imported first payment now carries the real date the producer
  // captured at import, so it is due on that day and not a moment sooner.
  // Acceptance-triggered installments are due the instant the artist accepts.
  if (installment.status === "overdue" || installment.dueTrigger === "acceptance") {
    return true;
  }
  const asOf = Date.parse(asOfIso);
  const dueAt = installment.dueAtIso ? Date.parse(installment.dueAtIso) : Number.NaN;
  if (Number.isFinite(asOf) && Number.isFinite(dueAt) && dueAt <= asOf) return true;
  return installment.dueTrigger === "artist_approval" && installment.triggeredAtIso !== null;
}

function waitsOnMilestone(installment: ClientPaymentInstallmentData): boolean {
  return (
    installment.remainingCents > 0 &&
    installment.dueAtIso === null &&
    installment.triggeredAtIso === null &&
    installment.dueTrigger !== "acceptance" &&
    installment.dueTrigger !== "producer_import" &&
    installment.status !== "confirmed" &&
    installment.status !== "waived" &&
    installment.status !== "canceled"
  );
}

function rowAction(
  installment: ClientPaymentInstallmentData,
  proofs: readonly ClientPaymentProofData[],
  asOfIso: string,
): ClientPaymentPrimaryAction {
  const latestProof = proofs[0];
  if (latestProof) return { kind: "open_proof", proofId: latestProof.id };
  if (isClosed(installment)) return { kind: "view_record" };
  if (isDueNow(installment, asOfIso)) return { kind: "send_reminder" };
  return { kind: "view_details" };
}

function currencySummaries(data: ClientPaymentsData): ClientPaymentCurrencySummary[] {
  const asOfDateKey = clientPaymentLocalDateKey(data.asOfIso, data.producerTimeZone);
  const asOfMonth = asOfDateKey?.slice(0, 7) ?? null;
  const totals = new Map<string, ClientPaymentCurrencySummary>();

  for (const project of data.projects) {
    for (const purchase of project.purchases) {
      const summary = totals.get(purchase.currency) ?? {
        currency: purchase.currency,
        paidAllTimeCents: 0,
        owesNowCents: 0,
        expectedThisMonthCents: 0,
        waitingOnMilestonesCents: 0,
      };
      summary.paidAllTimeCents += purchase.paidCents;
      summary.owesNowCents += purchase.dueNowCents;
      for (const installment of purchase.installments) {
        const dueMonth = installment.dueAtIso
          ? clientPaymentLocalDateKey(installment.dueAtIso, data.producerTimeZone)?.slice(0, 7)
          : null;
        if (
          asOfMonth !== null &&
          dueMonth === asOfMonth &&
          installment.status !== "canceled" &&
          installment.status !== "waived"
        ) {
          summary.expectedThisMonthCents += installment.amountCents;
        }
        if (waitsOnMilestone(installment)) {
          summary.waitingOnMilestonesCents += installment.remainingCents;
        }
      }
      totals.set(purchase.currency, summary);
    }
  }

  return [...totals.values()].sort((left, right) =>
    left.currency.localeCompare(right.currency, "en-US"),
  );
}

export function buildClientPaymentsView(data: ClientPaymentsData): ClientPaymentsView {
  const currentGroups: ClientPaymentProjectGroup[] = [];
  const historyGroups: ClientPaymentProjectGroup[] = [];
  let installmentCount = 0;
  let hasRecordedMoneyOrProof = false;

  for (const project of data.projects) {
    const currentRows: ClientPaymentRow[] = [];
    const historyRows: ClientPaymentRow[] = [];
    for (const purchase of project.purchases) {
      if (purchase.paidCents > 0 || purchase.proofs.length > 0) hasRecordedMoneyOrProof = true;
      for (const installment of purchase.installments) {
        installmentCount += 1;
        const proofs = purchase.proofs
          .filter((proof) => proof.installmentId === installment.id)
          .sort((left, right) => right.submittedAtIso.localeCompare(left.submittedAtIso));
        const row: ClientPaymentRow = {
          id: `${purchase.id}:${installment.id}`,
          project,
          purchase,
          installment,
          proofs,
          action: rowAction(installment, proofs, data.asOfIso),
        };
        (isClosed(installment) ? historyRows : currentRows).push(row);
      }
    }
    if (currentRows.length > 0) currentGroups.push({ project, rows: currentRows });
    if (historyRows.length > 0) historyGroups.push({ project, rows: historyRows });
  }

  const summaries = currencySummaries(data);
  const hasPayments = installmentCount > 0 || hasRecordedMoneyOrProof;
  const monetaryPurchases = data.projects.flatMap((project) =>
    project.purchases.filter((purchase) => purchase.totalCents > 0),
  );
  const allPaid =
    hasPayments &&
    monetaryPurchases.length > 0 &&
    monetaryPurchases.every((purchase) => purchase.recordStatus === "paid_in_full");

  return {
    currencySummaries: summaries,
    currentGroups,
    historyGroups,
    hasPayments,
    noCurrentDebt: hasPayments && summaries.every((summary) => summary.owesNowCents === 0),
    allPaid,
  };
}
