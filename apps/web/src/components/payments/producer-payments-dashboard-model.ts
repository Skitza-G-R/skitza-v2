export type ProducerPaymentsView = "overview" | "history";

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
}

export interface ProducerPaymentArtistRow {
  clientContactId: string;
  clientName: string;
  status: ProducerPaymentArtistStatus;
  receivedByCurrency: readonly ProducerPaymentCurrencyAmount[];
  owedNowByCurrency: readonly ProducerPaymentCurrencyAmount[];
  totalLeftByCurrency: readonly ProducerPaymentCurrencyAmount[];
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
        if (record.nextPayment) {
          nextPayments.push({
            purchaseId: record.id,
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
