import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
} from "./payment-history-view";

export type PaymentWorkspaceBucketId =
  | "needs_review"
  | "due_or_overdue"
  | "upcoming"
  | "history";

export type PaymentWorkspaceView = "all" | "open" | PaymentWorkspaceBucketId;

export interface PaymentWorkspaceBucket {
  id: PaymentWorkspaceBucketId;
  label: string;
  projects: readonly PaymentHistoryProject[];
}

export interface PaymentWorkspaceRow {
  id: string;
  bucketId: PaymentWorkspaceBucketId;
  project: PaymentHistoryProject;
  purchase: PaymentHistoryPurchase;
}

export interface PaymentWorkspaceFilters {
  view: PaymentWorkspaceView;
  query: string;
  /** `"all"` or one exact currency code. */
  currency: string;
  /** `"all"` or one exact project id. */
  projectId: string;
  /** `"all"` or one exact, producer-owned client contact id. */
  counterpartyId: string;
  /** Inclusive UTC calendar date for accepted purchases, or an empty string. */
  acceptedFrom: string;
  /** Inclusive UTC calendar date for accepted purchases, or an empty string. */
  acceptedTo: string;
}

export interface PaymentWorkspaceGroup {
  project: PaymentHistoryProject;
  rows: readonly PaymentWorkspaceRow[];
}

export interface PaymentWorkspaceCurrencySummary {
  currency: string;
  paidCents: number;
  dueNowCents: number;
  totalRemainingCents: number;
  purchaseCount: number;
}

export interface PaymentWorkspaceSummary {
  currencyTotals: readonly PaymentWorkspaceCurrencySummary[];
  totalCount: number;
  openCount: number;
  needsReviewCount: number;
}

const BUCKET_ORDER: Record<PaymentWorkspaceBucketId, number> = {
  needs_review: 0,
  due_or_overdue: 1,
  upcoming: 2,
  history: 3,
};

function uniqueRows(rows: readonly PaymentWorkspaceRow[]): PaymentWorkspaceRow[] {
  const seen = new Set<string>();

  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function dueStatusRank(row: PaymentWorkspaceRow): number {
  if (row.bucketId !== "due_or_overdue") return 0;

  const status = normalized(row.purchase.status.label);
  if (status.includes("overdue")) return 0;
  if (status.includes("due")) return 1;
  return 2;
}

function compareDueDates(
  left: PaymentHistoryPurchase["nextPayment"],
  right: PaymentHistoryPurchase["nextPayment"],
): number {
  const leftDueAt = left?.dueAtIso ?? null;
  const rightDueAt = right?.dueAtIso ?? null;

  if (leftDueAt === null && rightDueAt === null) return 0;
  if (leftDueAt === null) return 1;
  if (rightDueAt === null) return -1;

  const leftTime = Date.parse(leftDueAt);
  const rightTime = Date.parse(rightDueAt);
  const leftIsValid = Number.isFinite(leftTime);
  const rightIsValid = Number.isFinite(rightTime);

  if (leftIsValid && rightIsValid && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftIsValid !== rightIsValid) return leftIsValid ? -1 : 1;

  return compareText(leftDueAt, rightDueAt);
}

function rowTextKey(row: PaymentWorkspaceRow): string {
  return [
    row.project.title,
    row.purchase.title,
    row.purchase.reference,
    row.purchase.counterpartyLabel,
    row.purchase.status.label,
    row.id,
  ]
    .map(normalized)
    .join("\u0000");
}

function rowMatchesView(row: PaymentWorkspaceRow, view: PaymentWorkspaceView): boolean {
  if (view === "all") return true;
  if (view === "open") return row.bucketId !== "history";
  return row.bucketId === view;
}

function acceptedDateKey(row: PaymentWorkspaceRow): string | null {
  const acceptedAtIso = row.purchase.acceptance.acceptedAtIso;
  if (!acceptedAtIso) return null;

  const acceptedAt = new Date(acceptedAtIso);
  if (Number.isNaN(acceptedAt.getTime())) return null;
  return acceptedAt.toISOString().slice(0, 10);
}

export function isPaymentWorkspaceDateRangeValid(
  acceptedFrom: string,
  acceptedTo: string,
): boolean {
  return acceptedFrom.length === 0 || acceptedTo.length === 0 || acceptedFrom <= acceptedTo;
}

/**
 * Turns bucketed payment-history projections into one row per purchase.
 * The first projection of a duplicate purchase wins, preserving its exact project.
 */
export function buildPaymentWorkspaceRows(
  buckets: readonly PaymentWorkspaceBucket[],
): PaymentWorkspaceRow[] {
  const rows: PaymentWorkspaceRow[] = [];
  const seen = new Set<string>();

  for (const bucket of buckets) {
    for (const project of bucket.projects) {
      for (const purchase of project.purchases) {
        if (seen.has(purchase.id)) continue;
        seen.add(purchase.id);
        rows.push({
          id: purchase.id,
          bucketId: bucket.id,
          project,
          purchase,
        });
      }
    }
  }

  return rows;
}

export function filterPaymentWorkspaceRows(
  rows: readonly PaymentWorkspaceRow[],
  filters: PaymentWorkspaceFilters,
): PaymentWorkspaceRow[] {
  if (!isPaymentWorkspaceDateRangeValid(filters.acceptedFrom, filters.acceptedTo)) return [];

  const queryTokens = normalized(filters.query).split(/\s+/u).filter(Boolean);

  const filtered = uniqueRows(rows).filter((row) => {
    if (!rowMatchesView(row, filters.view)) return false;
    if (filters.currency !== "all" && row.purchase.currency !== filters.currency) return false;
    if (filters.projectId !== "all" && row.project.id !== filters.projectId) return false;
    if (
      filters.counterpartyId !== "all" &&
      row.purchase.counterpartyId !== filters.counterpartyId
    ) {
      return false;
    }

    if (filters.acceptedFrom || filters.acceptedTo) {
      const acceptedDate = acceptedDateKey(row);
      if (!acceptedDate) return false;
      if (filters.acceptedFrom && acceptedDate < filters.acceptedFrom) return false;
      if (filters.acceptedTo && acceptedDate > filters.acceptedTo) return false;
    }

    if (queryTokens.length === 0) return true;

    const searchableText = normalized(
      [
        row.project.title,
        row.purchase.title,
        row.purchase.reference,
        row.purchase.counterpartyLabel,
        row.purchase.status.label,
      ].join(" "),
    );

    return queryTokens.every((token) => searchableText.includes(token));
  });

  return filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const bucketDifference =
        BUCKET_ORDER[left.row.bucketId] - BUCKET_ORDER[right.row.bucketId];
      if (bucketDifference !== 0) return bucketDifference;

      const statusDifference = dueStatusRank(left.row) - dueStatusRank(right.row);
      if (statusDifference !== 0) return statusDifference;

      const dueDateDifference = compareDueDates(
        left.row.purchase.nextPayment,
        right.row.purchase.nextPayment,
      );
      if (dueDateDifference !== 0) return dueDateDifference;

      const textDifference = compareText(rowTextKey(left.row), rowTextKey(right.row));
      if (textDifference !== 0) return textDifference;

      return left.index - right.index;
    })
    .map(({ row }) => row);
}

export function groupPaymentWorkspaceRows(
  rows: readonly PaymentWorkspaceRow[],
): PaymentWorkspaceGroup[] {
  const groups: Array<{ project: PaymentHistoryProject; rows: PaymentWorkspaceRow[] }> = [];
  const groupByProjectId = new Map<
    string,
    { project: PaymentHistoryProject; rows: PaymentWorkspaceRow[] }
  >();

  for (const row of rows) {
    let group = groupByProjectId.get(row.project.id);
    if (!group) {
      group = { project: row.project, rows: [] };
      groupByProjectId.set(row.project.id, group);
      groups.push(group);
    }
    group.rows.push(row);
  }

  return groups;
}

export function summarizePaymentWorkspaceRows(
  rows: readonly PaymentWorkspaceRow[],
): PaymentWorkspaceSummary {
  const unique = uniqueRows(rows);
  const byCurrency = new Map<string, PaymentWorkspaceCurrencySummary>();

  for (const row of unique) {
    const existing = byCurrency.get(row.purchase.currency);
    if (existing) {
      existing.paidCents += row.purchase.paidCents;
      existing.dueNowCents += row.purchase.dueNowCents;
      existing.totalRemainingCents += row.purchase.totalRemainingCents;
      existing.purchaseCount += 1;
      continue;
    }

    byCurrency.set(row.purchase.currency, {
      currency: row.purchase.currency,
      paidCents: row.purchase.paidCents,
      dueNowCents: row.purchase.dueNowCents,
      totalRemainingCents: row.purchase.totalRemainingCents,
      purchaseCount: 1,
    });
  }

  return {
    currencyTotals: [...byCurrency.values()].sort((left, right) =>
      compareText(normalized(left.currency), normalized(right.currency)),
    ),
    totalCount: unique.length,
    openCount: unique.filter((row) => row.bucketId !== "history").length,
    needsReviewCount: unique.filter((row) => row.bucketId === "needs_review").length,
  };
}

export function workspaceViewCount(
  rows: readonly PaymentWorkspaceRow[],
  view: PaymentWorkspaceView,
): number {
  return uniqueRows(rows).filter((row) => rowMatchesView(row, view)).length;
}
