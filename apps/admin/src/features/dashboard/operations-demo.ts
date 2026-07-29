import type {
  DemoAnalytics,
  DemoPayment,
  DemoProblem,
} from "~/lib/admin-demo-view-models";

export type PaymentCurrencyFilter = "all" | DemoPayment["currency"];
export type PaymentSort = "amount-desc" | "project-asc" | "updated-desc";
export type PaymentStateFilter = "all" | DemoPayment["state"];
export type PaymentView = "all" | "attention";

export type ProblemStateFilter = "all" | "open" | DemoProblem["state"];
export type ProblemSeverityFilter = "all" | DemoProblem["severity"];

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function parsePaymentView(value: string | undefined): PaymentView {
  return value === "all" ? "all" : "attention";
}

function paymentAmount(payment: DemoPayment): number {
  return Number(payment.amount.replace(/[^\d.]/g, ""));
}

export function filterAndSortPayments({
  payments,
  query,
  currency,
  state,
  attentionOnly,
  sort,
}: {
  payments: readonly DemoPayment[];
  query: string;
  currency: PaymentCurrencyFilter;
  state: PaymentStateFilter;
  attentionOnly: boolean;
  sort: PaymentSort;
}): DemoPayment[] {
  const search = normalize(query);

  const matches = payments.filter((payment) => {
    const matchesSearch =
      search.length === 0 ||
      [payment.id, payment.project, payment.producer, payment.artist].some((value) =>
        normalize(value).includes(search),
      );

    return (
      matchesSearch &&
      (currency === "all" || payment.currency === currency) &&
      (state === "all" || payment.state === state) &&
      (!attentionOnly || payment.attentionReason !== undefined)
    );
  });

  if (sort === "updated-desc") return matches;

  return [...matches].sort((left, right) => {
    if (sort === "project-asc") return left.project.localeCompare(right.project);
    return paymentAmount(right) - paymentAmount(left);
  });
}

export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
): Readonly<{ items: readonly T[]; page: number; pageCount: number; total: number }> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page,
    pageCount,
    total: items.length,
  };
}

export function filterProblems({
  problems,
  query,
  provider,
  severity,
  state,
}: {
  problems: readonly DemoProblem[];
  query: string;
  provider: string;
  severity: ProblemSeverityFilter;
  state: ProblemStateFilter;
}): DemoProblem[] {
  const search = normalize(query);

  return problems.filter((problem) => {
    const matchesSearch =
      search.length === 0 ||
      [problem.id, problem.title, problem.detail, problem.provider].some((value) =>
        normalize(value).includes(search),
      );
    const matchesState =
      state === "all" ||
      (state === "open" && problem.state !== "Resolved") ||
      problem.state === state;

    return (
      matchesSearch &&
      matchesState &&
      (provider === "all" || problem.provider === provider) &&
      (severity === "all" || problem.severity === severity)
    );
  });
}

export function transitionProblem(
  problems: readonly DemoProblem[],
  problemId: string,
  state: DemoProblem["state"],
): DemoProblem[] {
  return problems.map((problem) => (problem.id === problemId ? { ...problem, state } : problem));
}

function escapeCsv(value: string | number): string {
  const rendered = String(value);
  return /[",\n]/.test(rendered) ? `"${rendered.replaceAll('"', '""')}"` : rendered;
}

export function buildAnalyticsCsv(data: DemoAnalytics): string {
  const rows: Array<readonly (number | string)[]> = [
    ["environment", data.environment],
    ["updated_at", data.updatedAt],
    [],
    ["metric", "value", "definition"],
    ...data.metrics.map((metric) => [metric.label, metric.value, metric.detail] as const),
    [],
    ["sales_currency", "recorded_amount"],
    ...data.salesByCurrency.map((point) => [point.label, point.value] as const),
  ];

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}
