export type ProducerPaymentsView = "overview" | "history";

/**
 * DOM id of the "Needs you" attention group in the payments workspace.
 * Shared so a link into that group can never drift from the element it
 * targets — the dashboard's payment-due row previously pointed at
 * `#payment-history-due-overdue`, which matched nothing.
 */
export const PAYMENTS_NEEDS_YOU_ANCHOR = "payments-needs-you";

export type ProducerPaymentTimePreset =
  | "this_month"
  | "last_month"
  | "this_year"
  | "all_time"
  | "custom";

export type ProducerPaymentStatusFilter =
  | "all"
  | "needs_review"
  | "overdue"
  | "due_now"
  | "upcoming"
  | "waiting_milestone"
  | "all_paid";

export type ProducerPaymentInstallmentStatus =
  | "not_paid"
  | "awaiting_review"
  | "partially_paid"
  | "confirmed"
  | "overdue"
  | "waived"
  | "canceled";

export type ProducerPaymentDueTrigger =
  | "acceptance"
  | "producer_import"
  | "monthly_anniversary"
  | "artist_approval";

export interface ProducerPaymentInstallment {
  id: string;
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  remainingCents: number;
  dueAtIso: string | null;
  triggeredAtIso: string | null;
  dueTrigger: ProducerPaymentDueTrigger;
  status: ProducerPaymentInstallmentStatus;
}

export interface ProducerPaymentNextPayment {
  installmentId: string;
  amountCents: number;
  dueAtIso: string | null;
  triggeredAtIso: string | null;
  dueTrigger: ProducerPaymentDueTrigger;
  status: ProducerPaymentInstallmentStatus;
}

export interface ProducerPaymentReceipt {
  id: string;
  installmentId: string;
  proofId: string | null;
  source: "proof" | "manual";
  originalAmountCents: number;
  effectiveAmountCents: number;
  paidAtIso: string;
  note: string | null;
}

export interface ProducerPaymentCorrection {
  id: string;
  paymentId: string;
  previousAmountCents: number;
  newAmountCents: number;
  reason: string;
  occurredAtIso: string;
}

export interface ProducerPaymentWaiver {
  id: string;
  installmentId: string;
  amountCents: number;
  reason: string;
  occurredAtIso: string;
}

export interface ProducerPaymentProof {
  id: string;
  installmentId: string;
  amountCents: number;
  currency: string;
  status: "pending" | "confirmed" | "rejected";
  submittedAtIso: string;
  reviewedAtIso: string | null;
}

export interface ProducerPaymentCancellation {
  id: string;
  reason: string;
  occurredAtIso: string;
}

export interface ProducerPaymentRecord {
  id: string;
  producerId: string;
  clientContactId: string;
  clientName: string;
  projectId: string;
  projectTitle: string;
  projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  purchaseTitle: string;
  purchaseReference: string;
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  isImportedExistingWork: boolean;
  currency: string;
  totalCents: number;
  paidCents: number;
  dueNowCents: number;
  totalRemainingCents: number;
  installments: readonly ProducerPaymentInstallment[];
  nextPayment: ProducerPaymentNextPayment | null;
  payments: readonly ProducerPaymentReceipt[];
  corrections: readonly ProducerPaymentCorrection[];
  waivers: readonly ProducerPaymentWaiver[];
  proofs: readonly ProducerPaymentProof[];
  cancellation: ProducerPaymentCancellation | null;
}

export interface ProducerPaymentsData {
  records: readonly ProducerPaymentRecord[];
}

export interface ProducerPaymentTimeRange {
  preset: ProducerPaymentTimePreset;
  fromDateKey: string | null;
  toDateKey: string | null;
  valid: boolean;
}

export interface ProducerPaymentRecordFilters {
  query: string;
  clientContactId: string;
  currency: string;
  projectId: string;
  status: ProducerPaymentStatusFilter;
}

export interface ProducerPaymentCurrencySummary {
  currency: string;
  receivedCents: number;
  expectedCents: number;
  owedNowCents: number;
  waitingOnMilestonesCents: number;
}

export interface ProducerPaymentCurrencyAmount {
  currency: string;
  cents: number;
}

export type ProducerPaymentArtistStatus =
  | "overdue"
  | "needs_review"
  | "due_now"
  | "waiting_milestone"
  | "upcoming"
  | "all_paid";

export interface ProducerPaymentArtistNextPayment {
  purchaseId: string;
  installmentId: string;
  purchaseTitle: string;
  projectTitle: string;
  currency: string;
  amountCents: number;
  dueAtIso: string | null;
  triggeredAtIso: string | null;
  dueTrigger: ProducerPaymentDueTrigger;
  status: ProducerPaymentInstallmentStatus;
}

export interface ProducerPaymentArtistProofAction {
  proofId: string;
  purchaseTitle: string;
  projectTitle: string;
  submittedAtIso: string;
}

export interface ProducerPaymentArtistRow {
  clientContactId: string;
  clientName: string;
  status: ProducerPaymentArtistStatus;
  receivedByCurrency: readonly ProducerPaymentCurrencyAmount[];
  owedNowByCurrency: readonly ProducerPaymentCurrencyAmount[];
  totalLeftByCurrency: readonly ProducerPaymentCurrencyAmount[];
  /** All-time money in, ignoring the time range — pairs with `totalByCurrency`. */
  paidByCurrency: readonly ProducerPaymentCurrencyAmount[];
  /** Everything this Artist ever agreed to pay, ignoring the time range. */
  totalByCurrency: readonly ProducerPaymentCurrencyAmount[];
  /** When money last actually arrived — all-time, never clipped by the range. */
  lastPaidAtIso: string | null;
  projectTitles: readonly string[];
  nextPayment: ProducerPaymentArtistNextPayment | null;
  pendingProofs: readonly ProducerPaymentArtistProofAction[];
  records: readonly ProducerPaymentRecord[];
}

export type ProducerPaymentHistoryKind =
  | "payment"
  | "proof"
  | "correction"
  | "waiver"
  | "cancellation";

export interface ProducerPaymentHistoryEvent {
  id: string;
  kind: ProducerPaymentHistoryKind;
  occurredAtIso: string;
  clientContactId: string;
  clientName: string;
  projectId: string;
  projectTitle: string;
  purchaseId: string;
  purchaseTitle: string;
  purchaseReference: string;
  currency: string;
  amountCents: number | null;
  previousAmountCents: number | null;
  statusLabel: string;
  detail: string | null;
  proofId: string | null;
}

export interface ProducerPaymentArtistPage {
  items: readonly ProducerPaymentArtistRow[];
  page: number;
  totalPages: number;
  totalItems: number;
}

const ARTISTS_PER_PAGE = 10;

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function safeTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return value;
  } catch {
    return "UTC";
  }
}

export function producerLocalDateKey(value: string | Date, timeZone: string): string | null {
  const date = value instanceof Date ? value : new Date(value);
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

function utcDateKey(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = utcDateKey(year, month - 1, day);
  return candidate === value ? { year, month, day } : null;
}

export function buildProducerPaymentTimeRange(
  preset: ProducerPaymentTimePreset,
  nowIso: string,
  timeZone: string,
  customFrom = "",
  customTo = "",
): ProducerPaymentTimeRange {
  if (preset === "all_time") {
    return { preset, fromDateKey: null, toDateKey: null, valid: true };
  }
  if (preset === "custom") {
    const from = parseDateKey(customFrom);
    const to = parseDateKey(customTo);
    return {
      preset,
      fromDateKey: from ? customFrom : null,
      toDateKey: to ? customTo : null,
      valid: Boolean(from && to && customFrom <= customTo),
    };
  }

  const todayKey = producerLocalDateKey(nowIso, timeZone);
  if (!todayKey) return { preset, fromDateKey: null, toDateKey: null, valid: false };
  const today = parseDateKey(todayKey);
  if (!today) return { preset, fromDateKey: null, toDateKey: null, valid: false };

  if (preset === "this_year") {
    return {
      preset,
      fromDateKey: utcDateKey(today.year, 0, 1),
      toDateKey: utcDateKey(today.year, 11, 31),
      valid: true,
    };
  }

  const monthOffset = preset === "last_month" ? -1 : 0;
  const first = new Date(Date.UTC(today.year, today.month - 1 + monthOffset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return {
    preset,
    fromDateKey: utcDateKey(first.getUTCFullYear(), first.getUTCMonth(), 1),
    toDateKey: utcDateKey(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()),
    valid: true,
  };
}

export function defaultProducerPaymentCustomRange(
  nowIso: string,
  timeZone: string,
): Readonly<{ from: string; to: string }> {
  const range = buildProducerPaymentTimeRange("this_month", nowIso, timeZone);
  const today = producerLocalDateKey(nowIso, timeZone);
  return {
    from: range.fromDateKey ?? today ?? "",
    to: today ?? range.toDateKey ?? "",
  };
}

function rangeContains(
  isoValue: string,
  range: ProducerPaymentTimeRange,
  timeZone: string,
): boolean {
  if (!range.valid) return false;
  if (range.fromDateKey === null && range.toDateKey === null) return true;
  const dateKey = producerLocalDateKey(isoValue, timeZone);
  if (!dateKey) return false;
  if (range.fromDateKey && dateKey < range.fromDateKey) return false;
  if (range.toDateKey && dateKey > range.toDateKey) return false;
  return true;
}

export function waitingOnMilestonesCents(record: ProducerPaymentRecord): number {
  return record.installments.reduce((sum, installment) => {
    if (
      installment.remainingCents <= 0 ||
      installment.dueAtIso !== null ||
      installment.triggeredAtIso !== null ||
      installment.dueTrigger === "acceptance" ||
      installment.dueTrigger === "producer_import" ||
      installment.status === "confirmed" ||
      installment.status === "waived" ||
      installment.status === "canceled"
    ) {
      return sum;
    }
    return sum + installment.remainingCents;
  }, 0);
}

function recordHasPendingProof(record: ProducerPaymentRecord): boolean {
  return record.proofs.some((proof) => proof.status === "pending");
}

function recordIsOverdue(record: ProducerPaymentRecord): boolean {
  return record.installments.some(
    (installment) => installment.status === "overdue" && installment.remainingCents > 0,
  );
}

function recordHasUpcomingPayment(record: ProducerPaymentRecord): boolean {
  return record.installments.some(
    (installment) =>
      installment.remainingCents > 0 &&
      installment.status !== "canceled" &&
      installment.status !== "waived" &&
      installment.dueAtIso !== null,
  );
}

function recordMatchesStatus(
  record: ProducerPaymentRecord,
  status: ProducerPaymentStatusFilter,
): boolean {
  if (status === "all") return true;
  if (status === "needs_review") return recordHasPendingProof(record);
  if (status === "overdue") return recordIsOverdue(record);
  if (status === "due_now") return record.dueNowCents > 0 && !recordIsOverdue(record);
  if (status === "waiting_milestone") return waitingOnMilestonesCents(record) > 0;
  if (status === "all_paid") return record.totalRemainingCents === 0;
  return (
    !recordHasPendingProof(record) &&
    !recordIsOverdue(record) &&
    record.dueNowCents === 0 &&
    waitingOnMilestonesCents(record) === 0 &&
    recordHasUpcomingPayment(record) &&
    record.totalRemainingCents > 0
  );
}

export function filterProducerPaymentRecords(
  records: readonly ProducerPaymentRecord[],
  filters: ProducerPaymentRecordFilters,
): ProducerPaymentRecord[] {
  const tokens = normalized(filters.query).split(/\s+/u).filter(Boolean);
  return records.filter((record) => {
    if (filters.clientContactId !== "all" && record.clientContactId !== filters.clientContactId) {
      return false;
    }
    if (filters.currency !== "all" && record.currency !== filters.currency) return false;
    if (filters.projectId !== "all" && record.projectId !== filters.projectId) return false;
    if (!recordMatchesStatus(record, filters.status)) return false;
    if (tokens.length === 0) return true;
    const searchable = normalized(
      [record.clientName, record.projectTitle, record.purchaseTitle, record.purchaseReference].join(
        " ",
      ),
    );
    return tokens.every((token) => searchable.includes(token));
  });
}

function sortedCurrencyAmounts(
  values: ReadonlyMap<string, number>,
): ProducerPaymentCurrencyAmount[] {
  return [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, cents]) => ({ currency, cents }));
}

export function summarizeProducerPayments(
  records: readonly ProducerPaymentRecord[],
  range: ProducerPaymentTimeRange,
  timeZone: string,
): ProducerPaymentCurrencySummary[] {
  const totals = new Map<string, ProducerPaymentCurrencySummary>();
  for (const record of records) {
    const total = totals.get(record.currency) ?? {
      currency: record.currency,
      receivedCents: 0,
      expectedCents: 0,
      owedNowCents: 0,
      waitingOnMilestonesCents: 0,
    };
    total.receivedCents += record.payments.reduce(
      (sum, payment) =>
        rangeContains(payment.paidAtIso, range, timeZone)
          ? sum + payment.effectiveAmountCents
          : sum,
      0,
    );
    total.expectedCents += record.installments.reduce((sum, installment) => {
      if (
        installment.dueAtIso === null ||
        installment.status === "canceled" ||
        installment.status === "waived" ||
        !rangeContains(installment.dueAtIso, range, timeZone)
      ) {
        return sum;
      }
      return sum + installment.amountCents;
    }, 0);
    total.owedNowCents += record.dueNowCents;
    total.waitingOnMilestonesCents += waitingOnMilestonesCents(record);
    totals.set(record.currency, total);
  }
  return [...totals.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function nextPaymentRank(
  candidate: ProducerPaymentArtistNextPayment,
  nowDateKey: string | null,
  timeZone: string,
): readonly [number, string] {
  if (candidate.status === "overdue") return [0, candidate.dueAtIso ?? ""];
  if (candidate.dueAtIso) {
    const dueKey = producerLocalDateKey(candidate.dueAtIso, timeZone) ?? candidate.dueAtIso;
    return [nowDateKey && dueKey <= nowDateKey ? 1 : 2, dueKey];
  }
  return [candidate.triggeredAtIso ? 1 : 3, candidate.triggeredAtIso ?? candidate.purchaseTitle];
}

function artistStatus(records: readonly ProducerPaymentRecord[]): ProducerPaymentArtistStatus {
  if (records.some(recordIsOverdue)) return "overdue";
  if (records.some(recordHasPendingProof)) return "needs_review";
  if (records.some((record) => record.dueNowCents > 0)) return "due_now";
  if (records.some((record) => waitingOnMilestonesCents(record) > 0)) {
    return "waiting_milestone";
  }
  if (records.some((record) => record.totalRemainingCents > 0)) return "upcoming";
  return "all_paid";
}

const ARTIST_STATUS_RANK: Record<ProducerPaymentArtistStatus, number> = {
  overdue: 0,
  needs_review: 1,
  due_now: 2,
  waiting_milestone: 3,
  upcoming: 4,
  all_paid: 5,
};

export function aggregateProducerPaymentArtists(
  records: readonly ProducerPaymentRecord[],
  range: ProducerPaymentTimeRange,
  timeZone: string,
  nowIso: string,
): ProducerPaymentArtistRow[] {
  const byClient = new Map<string, ProducerPaymentRecord[]>();
  for (const record of records) {
    const current = byClient.get(record.clientContactId) ?? [];
    current.push(record);
    byClient.set(record.clientContactId, current);
  }
  const nowDateKey = producerLocalDateKey(nowIso, timeZone);

  return [...byClient.values()]
    .map((clientRecords): ProducerPaymentArtistRow => {
      const first = clientRecords[0];
      if (!first) throw new Error("Artist payment group cannot be empty");
      const received = new Map<string, number>();
      const owedNow = new Map<string, number>();
      const totalLeft = new Map<string, number>();
      const paid = new Map<string, number>();
      const total = new Map<string, number>();
      let lastPaidAtIso: string | null = null;
      const projectTitles = new Map<string, string>();
      const nextPayments: ProducerPaymentArtistNextPayment[] = [];
      const pendingProofs: ProducerPaymentArtistProofAction[] = [];

      for (const record of clientRecords) {
        const recordReceived = record.payments.reduce(
          (sum, payment) =>
            rangeContains(payment.paidAtIso, range, timeZone)
              ? sum + payment.effectiveAmountCents
              : sum,
          0,
        );
        received.set(record.currency, (received.get(record.currency) ?? 0) + recordReceived);
        owedNow.set(record.currency, (owedNow.get(record.currency) ?? 0) + record.dueNowCents);
        totalLeft.set(
          record.currency,
          (totalLeft.get(record.currency) ?? 0) + record.totalRemainingCents,
        );
        paid.set(record.currency, (paid.get(record.currency) ?? 0) + record.paidCents);
        for (const payment of record.payments) {
          if (lastPaidAtIso === null || payment.paidAtIso > lastPaidAtIso) {
            lastPaidAtIso = payment.paidAtIso;
          }
        }
        total.set(record.currency, (total.get(record.currency) ?? 0) + record.totalCents);
        projectTitles.set(record.projectId, record.projectTitle);
        if (record.nextPayment) {
          nextPayments.push({
            purchaseId: record.id,
            installmentId: record.nextPayment.installmentId,
            purchaseTitle: record.purchaseTitle,
            projectTitle: record.projectTitle,
            currency: record.currency,
            amountCents: record.nextPayment.amountCents,
            dueAtIso: record.nextPayment.dueAtIso,
            triggeredAtIso: record.nextPayment.triggeredAtIso,
            dueTrigger: record.nextPayment.dueTrigger,
            status: record.nextPayment.status,
          });
        }
        for (const proof of record.proofs) {
          if (proof.status !== "pending") continue;
          pendingProofs.push({
            proofId: proof.id,
            purchaseTitle: record.purchaseTitle,
            projectTitle: record.projectTitle,
            submittedAtIso: proof.submittedAtIso,
          });
        }
      }
      nextPayments.sort((left, right) => {
        const [leftRank, leftKey] = nextPaymentRank(left, nowDateKey, timeZone);
        const [rightRank, rightKey] = nextPaymentRank(right, nowDateKey, timeZone);
        return leftRank - rightRank || leftKey.localeCompare(rightKey);
      });

      return {
        clientContactId: first.clientContactId,
        clientName: first.clientName,
        status: artistStatus(clientRecords),
        receivedByCurrency: sortedCurrencyAmounts(received),
        owedNowByCurrency: sortedCurrencyAmounts(owedNow),
        totalLeftByCurrency: sortedCurrencyAmounts(totalLeft),
        paidByCurrency: sortedCurrencyAmounts(paid),
        totalByCurrency: sortedCurrencyAmounts(total),
        lastPaidAtIso,
        projectTitles: [...projectTitles.values()].sort((left, right) =>
          left.localeCompare(right),
        ),
        nextPayment: nextPayments[0] ?? null,
        pendingProofs,
        records: clientRecords,
      };
    })
    .sort(
      (left, right) =>
        ARTIST_STATUS_RANK[left.status] - ARTIST_STATUS_RANK[right.status] ||
        left.clientName.localeCompare(right.clientName),
    );
}

export function buildProducerPaymentHistory(
  records: readonly ProducerPaymentRecord[],
  range: ProducerPaymentTimeRange,
  timeZone: string,
): ProducerPaymentHistoryEvent[] {
  const events: ProducerPaymentHistoryEvent[] = [];
  for (const record of records) {
    const base = {
      clientContactId: record.clientContactId,
      clientName: record.clientName,
      projectId: record.projectId,
      projectTitle: record.projectTitle,
      purchaseId: record.id,
      purchaseTitle: record.purchaseTitle,
      purchaseReference: record.purchaseReference,
      currency: record.currency,
    };
    for (const payment of record.payments) {
      if (!rangeContains(payment.paidAtIso, range, timeZone)) continue;
      events.push({
        ...base,
        id: `payment:${payment.id}`,
        kind: "payment",
        occurredAtIso: payment.paidAtIso,
        amountCents: payment.effectiveAmountCents,
        previousAmountCents: null,
        statusLabel:
          payment.source === "proof"
            ? "Confirmed"
            : record.isImportedExistingWork
              ? "Confirmed by producer"
              : "Recorded manually",
        detail: payment.note,
        proofId: payment.proofId,
      });
    }
    for (const correction of record.corrections) {
      if (!rangeContains(correction.occurredAtIso, range, timeZone)) continue;
      events.push({
        ...base,
        id: `correction:${correction.id}`,
        kind: "correction",
        occurredAtIso: correction.occurredAtIso,
        amountCents: correction.newAmountCents,
        previousAmountCents: correction.previousAmountCents,
        statusLabel: "Corrected",
        detail: correction.reason,
        proofId: null,
      });
    }
    for (const waiver of record.waivers) {
      if (!rangeContains(waiver.occurredAtIso, range, timeZone)) continue;
      events.push({
        ...base,
        id: `waiver:${waiver.id}`,
        kind: "waiver",
        occurredAtIso: waiver.occurredAtIso,
        amountCents: waiver.amountCents,
        previousAmountCents: null,
        statusLabel: "Waived",
        detail: waiver.reason,
        proofId: null,
      });
    }
    for (const proof of record.proofs) {
      const occurredAtIso = proof.reviewedAtIso ?? proof.submittedAtIso;
      if (!rangeContains(occurredAtIso, range, timeZone)) continue;
      events.push({
        ...base,
        id: `proof:${proof.id}`,
        kind: "proof",
        occurredAtIso,
        amountCents: proof.amountCents,
        previousAmountCents: null,
        statusLabel:
          proof.status === "pending"
            ? "Needs review"
            : proof.status === "confirmed"
              ? "Proof confirmed"
              : "Proof rejected",
        detail: null,
        proofId: proof.id,
      });
    }
    if (record.cancellation && rangeContains(record.cancellation.occurredAtIso, range, timeZone)) {
      events.push({
        ...base,
        id: `cancellation:${record.cancellation.id}`,
        kind: "cancellation",
        occurredAtIso: record.cancellation.occurredAtIso,
        amountCents: null,
        previousAmountCents: null,
        statusLabel: "Canceled",
        detail: record.cancellation.reason,
        proofId: null,
      });
    }
  }
  return events.sort(
    (left, right) =>
      Date.parse(right.occurredAtIso) - Date.parse(left.occurredAtIso) ||
      left.id.localeCompare(right.id),
  );
}

export function paginateProducerPaymentArtists(
  artists: readonly ProducerPaymentArtistRow[],
  requestedPage: number,
): ProducerPaymentArtistPage {
  const totalPages = Math.max(1, Math.ceil(artists.length / ARTISTS_PER_PAGE));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const offset = (page - 1) * ARTISTS_PER_PAGE;
  return {
    items: artists.slice(offset, offset + ARTISTS_PER_PAGE),
    page,
    totalPages,
    totalItems: artists.length,
  };
}

// SK-275 — the Overview row speaks in dates. Every value below is derived from
// what `purchaseLedger.overview()` already returns; nothing new is fetched.

const DUE_TRIGGER_PHRASES: Record<ProducerPaymentDueTrigger, string> = {
  artist_approval: "After final approval",
  acceptance: "At acceptance",
  producer_import: "When added to Skitza",
  monthly_anniversary: "After the first payment",
};

const TIMING_TONE: Record<ProducerPaymentArtistStatus, ProducerPaymentTimingTone> = {
  overdue: "danger",
  needs_review: "accent",
  due_now: "danger",
  waiting_milestone: "muted",
  upcoming: "muted",
  all_paid: "muted",
};

export type ProducerPaymentTimingTone = "accent" | "danger" | "muted";

export interface ProducerPaymentTiming {
  text: string;
  tone: ProducerPaymentTimingTone;
}

export interface ProducerPaymentArtistProgress {
  currency: string;
  paidCents: number;
  totalCents: number;
  percent: number;
}

export interface ProducerPaymentNeedsYou {
  overdueArtists: number;
  pendingProofs: number;
}

/** Whole days from one instant to another, counted in the producer's own calendar. */
export function producerPaymentDaysBetween(
  fromIso: string,
  toIso: string,
  timeZone: string,
): number | null {
  const fromKey = producerLocalDateKey(fromIso, timeZone);
  const toKey = producerLocalDateKey(toIso, timeZone);
  if (!fromKey || !toKey) return null;
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) return null;
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / 86_400_000);
}

/** "Aug 12" inside the current year, "Aug 12, 2027" outside it. */
export function producerPaymentShortDate(
  value: string,
  timeZone: string,
  nowIso: string,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  const zone = safeTimeZone(timeZone);
  const sameYear =
    producerLocalDateKey(value, zone)?.slice(0, 4) === producerLocalDateKey(nowIso, zone)?.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: zone,
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

function earliestPendingProof(
  proofs: readonly ProducerPaymentArtistProofAction[],
): ProducerPaymentArtistProofAction | null {
  return (
    [...proofs].sort(
      (left, right) => Date.parse(left.submittedAtIso) - Date.parse(right.submittedAtIso),
    )[0] ?? null
  );
}

/**
 * The one line under an Artist name: a real date plus how far away it is.
 * A waiting proof outranks the next payment — reviewing it is the next move.
 */
export function producerPaymentTiming(
  artist: ProducerPaymentArtistRow,
  timeZone: string,
  nowIso: string,
): ProducerPaymentTiming {
  const tone = TIMING_TONE[artist.status];
  const proof = earliestPendingProof(artist.pendingProofs);
  if (proof) {
    const date = producerPaymentShortDate(proof.submittedAtIso, timeZone, nowIso);
    const days = producerPaymentDaysBetween(proof.submittedAtIso, nowIso, timeZone);
    if (days === null) return { text: `Proof sent ${date}`, tone };
    if (days <= 0) return { text: `Proof sent today`, tone };
    return { text: `Proof sent ${date} · ${String(days)}d ago`, tone };
  }

  const next = artist.nextPayment;
  if (!next) return { text: "All paid", tone };

  if (next.dueAtIso) {
    const date = producerPaymentShortDate(next.dueAtIso, timeZone, nowIso);
    const days = producerPaymentDaysBetween(nowIso, next.dueAtIso, timeZone);
    // The domain's own `overdue` wins over the calendar: never promise "in 4d"
    // for money the ledger has already called late, and never invent a day
    // count the dates cannot justify.
    if (next.status === "overdue" || (days !== null && days < 0)) {
      return days !== null && days < 0
        ? { text: `Was due ${date} · ${String(-days)}d late`, tone }
        : { text: `Was due ${date}`, tone };
    }
    if (days === null) return { text: `Due ${date}`, tone };
    if (days === 0) return { text: "Due today", tone };
    return { text: `Due ${date} · in ${String(days)}d`, tone };
  }

  if (next.dueTrigger === "artist_approval" && next.triggeredAtIso) {
    return { text: "Final approval reached", tone };
  }
  if (next.dueTrigger === "monthly_anniversary" && next.triggeredAtIso) {
    return { text: "Monthly payment due", tone };
  }
  return { text: DUE_TRIGGER_PHRASES[next.dueTrigger], tone };
}

/** Paid against the whole agreed amount, one entry per currency the Artist uses. */
export function producerPaymentArtistProgress(
  artist: ProducerPaymentArtistRow,
): ProducerPaymentArtistProgress[] {
  const totals = new Map(artist.totalByCurrency.map((amount) => [amount.currency, amount.cents]));
  const paids = new Map(artist.paidByCurrency.map((amount) => [amount.currency, amount.cents]));
  return [...new Set([...totals.keys(), ...paids.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((currency) => {
      const totalCents = totals.get(currency) ?? 0;
      const paidCents = paids.get(currency) ?? 0;
      return {
        currency,
        paidCents,
        totalCents,
        percent: totalCents > 0 ? Math.min(100, Math.round((paidCents / totalCents) * 100)) : 0,
      };
    });
}

/** Drives the strip above the list. Both counts zero means the strip is not rendered. */
export function producerPaymentNeedsYou(
  artists: readonly ProducerPaymentArtistRow[],
): ProducerPaymentNeedsYou {
  let overdueArtists = 0;
  let pendingProofs = 0;
  for (const artist of artists) {
    if (artist.status === "overdue") overdueArtists += 1;
    pendingProofs += artist.pendingProofs.length;
  }
  return { overdueArtists, pendingProofs };
}

/** One project reads in full; several collapse so the row stays on one line. */
export function producerPaymentProjectLabel(titles: readonly string[]): string | null {
  const [first, ...rest] = titles;
  if (!first) return null;
  return rest.length === 0 ? first : `${first} +${String(rest.length)} more`;
}

// SK-275 — grouping replaces colour-coding: the heading above a row already
// says whether it needs the producer, so the row itself can stay quiet.

export type ProducerPaymentAttention = "needs_you" | "coming_up" | "paid_up";

export interface ProducerPaymentLine {
  /** Null when the money would not match the sentence — a waiting proof, or nothing left. */
  amountCents: number | null;
  currency: string;
  detail: string;
  tone: ProducerPaymentTimingTone;
}

const PLAIN_TRIGGER_PHRASES: Record<ProducerPaymentDueTrigger, string> = {
  artist_approval: "after final approval",
  acceptance: "when the artist accepts",
  producer_import: "when added to Skitza",
  monthly_anniversary: "after the first payment",
};

export function producerPaymentAttention(
  artist: ProducerPaymentArtistRow,
): ProducerPaymentAttention {
  if (artist.status === "all_paid") return "paid_up";
  if (
    artist.status === "overdue" ||
    artist.status === "needs_review" ||
    artist.status === "due_now"
  ) {
    return "needs_you";
  }
  return "coming_up";
}

function dayCount(days: number): string {
  return days === 1 ? "1 day" : `${String(days)} days`;
}

/**
 * One plain sentence per row. The amount is returned separately so the row can
 * lead with it, and is withheld whenever it would not describe the sentence —
 * a proof's value is not the next payment's value.
 */
export function producerPaymentLine(
  artist: ProducerPaymentArtistRow,
  timeZone: string,
  nowIso: string,
): ProducerPaymentLine {
  const tone = TIMING_TONE[artist.status];
  const currency = artist.nextPayment?.currency ?? artist.totalByCurrency[0]?.currency ?? "USD";

  const proof = earliestPendingProof(artist.pendingProofs);
  if (proof) {
    const date = producerPaymentShortDate(proof.submittedAtIso, timeZone, nowIso);
    return { amountCents: null, currency, detail: `Proof to check — sent ${date}`, tone };
  }

  const next = artist.nextPayment;
  if (!next) return { amountCents: null, currency, detail: "Fully paid", tone };

  const amountCents = next.amountCents;
  if (next.dueAtIso) {
    const date = producerPaymentShortDate(next.dueAtIso, timeZone, nowIso);
    const days = producerPaymentDaysBetween(nowIso, next.dueAtIso, timeZone);
    // The ledger's own `overdue` outranks the calendar.
    if (next.status === "overdue" || (days !== null && days < 0)) {
      return {
        amountCents,
        currency,
        detail:
          days !== null && days < 0
            ? `was due ${date}, ${dayCount(-days)} ago`
            : `was due ${date}`,
        tone,
      };
    }
    if (days === null) return { amountCents, currency, detail: `due ${date}`, tone };
    if (days === 0) return { amountCents, currency, detail: "due today", tone };
    return { amountCents, currency, detail: `due ${date}, in ${dayCount(days)}`, tone };
  }

  if (next.dueTrigger === "artist_approval" && next.triggeredAtIso) {
    return { amountCents, currency, detail: "final approval is done", tone };
  }
  if (next.dueTrigger === "monthly_anniversary" && next.triggeredAtIso) {
    return { amountCents, currency, detail: "monthly payment", tone };
  }
  return { amountCents, currency, detail: PLAIN_TRIGGER_PHRASES[next.dueTrigger], tone };
}

/** "last paid Jul 30", or an honest note when no money has arrived yet. */
export function producerPaymentLastPaidLabel(
  artist: ProducerPaymentArtistRow,
  timeZone: string,
  nowIso: string,
): string {
  if (artist.lastPaidAtIso === null) return "no payments yet";
  return `last paid ${producerPaymentShortDate(artist.lastPaidAtIso, timeZone, nowIso)}`;
}
