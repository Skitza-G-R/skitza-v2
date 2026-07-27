import * as React from "react";
import type { ChangeEvent, ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
} from "../payment-history-view";
import {
  ProducerPaymentWorkspace,
  type ProducerPaymentWorkspaceProps,
} from "../producer-payment-workspace";
import type { PaymentWorkspaceBucket } from "../producer-payment-workspace-model";

const usdPurchase: PaymentHistoryPurchase = {
  id: "purchase-usd",
  reference: "SK-USD-101",
  title: "Mix & master",
  counterpartyLabel: "Maya Stone",
  currency: "USD",
  status: { label: "Needs review", tone: "accent" },
  defaultOpen: true,
  totalCents: 150_000,
  paidCents: 100_000,
  dueNowCents: 25_000,
  totalRemainingCents: 50_000,
  delivery: {
    key: "locked",
    label: "Downloads locked",
    description: "Downloads unlock after payment.",
    paidCents: 100_000,
    waivedCents: 0,
    remainingCents: 50_000,
    overdue: false,
    activeOverrideVersionLabels: [],
    googleDriveLinks: [],
    withheldGoogleDriveLinkCount: 0,
  },
  frozenTerms: {
    frozenAtIso: "2026-07-01T09:00:00.000Z",
    productName: "Mix & master",
    deliverables: ["Final master"],
    lineItems: [
      {
        id: "line-usd",
        label: "Production",
        quantity: 1,
        unitPriceCents: 150_000,
        totalCents: 150_000,
      },
    ],
    subtotalCents: 150_000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 150_000,
    detailRows: [],
    rights: [],
    agreementText: "FULL DOSSIER SENTINEL",
  },
  acceptance: {
    acceptedAtIso: "2026-07-01T09:00:00.000Z",
    acceptedByLabel: "Maya Stone",
    statement: null,
  },
  plan: { label: "Two payments", description: null },
  schedule: [],
  nextPayment: {
    amountCents: 25_000,
    dueAtIso: "2026-08-01T09:00:00.000Z",
    trigger: null,
  },
  showPayNextPayment: false,
  currentInstructions: null,
  proofs: [
    {
      id: "proof-pending",
      installmentLabel: "Final payment",
      amountCents: 25_000,
      currency: "USD",
      status: "pending",
      originalFileName: "receipt.pdf",
      submittedAtIso: "2026-07-20T09:00:00.000Z",
      reviewedAtIso: null,
      note: null,
      rejectionNote: null,
      detailAvailable: true,
    },
  ],
  payments: [],
  corrections: [],
  waivers: [],
  cancellations: [],
  pauseHistory: [],
  downloadOverrideHistory: [],
};

const ilsPurchase: PaymentHistoryPurchase = {
  ...usdPurchase,
  id: "purchase-ils",
  reference: "SK-ILS-202",
  title: "Vocal production",
  counterpartyLabel: "Noa Green",
  currency: "ILS",
  status: { label: "Upcoming", tone: "active" },
  totalCents: 300_000,
  paidCents: 200_000,
  dueNowCents: 0,
  totalRemainingCents: 100_000,
  delivery: {
    ...usdPurchase.delivery,
    paidCents: 200_000,
    remainingCents: 100_000,
  },
  frozenTerms: {
    ...usdPurchase.frozenTerms,
    productName: "Vocal production",
    subtotalCents: 300_000,
    totalCents: 300_000,
  },
  nextPayment: {
    amountCents: 100_000,
    dueAtIso: null,
    trigger: "When the final vocal is approved",
  },
  proofs: [],
};

const usdProject: PaymentHistoryProject = {
  id: "project-usd",
  title: "Maya debut EP",
  status: { label: "Active", tone: "active" },
  currencyTotals: [
    { currency: "USD", dueNowCents: 25_000, totalRemainingCents: 50_000 },
  ],
  purchases: [usdPurchase],
};

const ilsProject: PaymentHistoryProject = {
  id: "project-ils",
  title: "Noa single",
  status: { label: "Active", tone: "active" },
  currencyTotals: [
    { currency: "ILS", dueNowCents: 0, totalRemainingCents: 100_000 },
  ],
  purchases: [ilsPurchase],
};

const buckets: readonly PaymentWorkspaceBucket[] = [
  { id: "needs_review", label: "Needs review", projects: [usdProject] },
  { id: "due_or_overdue", label: "Due now", projects: [] },
  { id: "upcoming", label: "Upcoming", projects: [ilsProject] },
  { id: "history", label: "History", projects: [] },
];

function longLedgerBuckets(purchaseCount: number): readonly PaymentWorkspaceBucket[] {
  const purchases = Array.from({ length: purchaseCount }, (_, index) => ({
    ...usdPurchase,
    id: `purchase-long-${String(index)}`,
    reference: `SK-LONG-${String(index).padStart(3, "0")}`,
    title: `Long ledger purchase ${String(index)}`,
    proofs: [],
  }));

  return [
    {
      id: "due_or_overdue",
      label: "Due now",
      projects: [
        {
          ...usdProject,
          id: "project-long-ledger",
          title: "Long ledger project",
          purchases,
        },
      ],
    },
    { id: "needs_review", label: "Needs review", projects: [] },
    { id: "upcoming", label: "Upcoming", projects: [] },
    { id: "history", label: "History", projects: [] },
  ];
}

function count(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

type TestElement = ReactElement<Record<string, unknown>>;

type HookDispatcher = {
  useCallback<T>(callback: T): T;
  useEffect(): void;
  useId(): string;
  useMemo<T>(factory: () => T): T;
  useRef<T>(initialValue: T): { current: T };
  useState<T>(
    initialValue: T | (() => T),
  ): [T, (update: T | ((current: T) => T)) => void];
};

type ReactClientInternals = {
  H: HookDispatcher | null;
};

/**
 * Vitest runs in Node and the workspace intentionally has no jsdom or
 * react-test-renderer dependency. This harness still executes the component's
 * real event callbacks and hook updates: it supplies a tiny state dispatcher,
 * then server-renders each resulting React tree for observable assertions.
 */
function createInteractionHarness(props: ProducerPaymentWorkspaceProps) {
  const slots: unknown[] = [];
  let cursor = 0;

  function slot<T>(initialValue: () => T): { index: number; value: T } {
    const index = cursor;
    cursor += 1;
    if (!(index in slots)) slots[index] = initialValue();
    return { index, value: slots[index] as T };
  }

  const dispatcher: HookDispatcher = {
    useCallback<T>(callback: T): T {
      cursor += 1;
      return callback;
    },
    useEffect(): void {
      cursor += 1;
    },
    useId(): string {
      return slot(() => "payment-workspace-interaction").value;
    },
    useMemo<T>(factory: () => T): T {
      cursor += 1;
      return factory();
    },
    useRef<T>(initialValue: T): { current: T } {
      return slot(() => ({ current: initialValue })).value;
    },
    useState<T>(
      initialValue: T | (() => T),
    ): [T, (update: T | ((current: T) => T)) => void] {
      const state = slot<T>(() =>
        typeof initialValue === "function"
          ? (initialValue as () => T)()
          : initialValue,
      );
      return [
        state.value,
        (update) => {
          const current = slots[state.index] as T;
          slots[state.index] =
            typeof update === "function"
              ? (update as (value: T) => T)(current)
              : update;
        },
      ];
    },
  };

  function renderTree(): ReactElement {
    cursor = 0;
    const internals = (
      React as unknown as {
        __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactClientInternals;
      }
    ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const previousDispatcher = internals.H;
    internals.H = dispatcher;
    try {
      return ProducerPaymentWorkspace(props);
    } finally {
      internals.H = previousDispatcher;
    }
  }

  return {
    renderTree,
    html: () => renderToStaticMarkup(renderTree()),
  };
}

function elementText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!React.isValidElement<Record<string, unknown>>(node)) return "";
  return elementText(node.props.children as ReactNode);
}

function findElement(
  node: ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child as ReactNode, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  if (predicate(node)) return node;
  return findElement(node.props.children as ReactNode, predicate);
}

function clickButton(tree: ReactElement, label: string): void {
  const button = findElement(
    tree,
    (element) =>
      element.type === "button" &&
      elementText(element).replaceAll(/\s+/g, " ").trim().startsWith(label),
  );
  expect(button, `button "${label}"`).not.toBeNull();
  const onClick = button?.props.onClick;
  expect(onClick).toBeTypeOf("function");
  (onClick as () => void)();
}

function changeSelect(tree: ReactElement, ariaLabel: string, value: string): void {
  const select = findElement(
    tree,
    (element) =>
      element.type === "select" && element.props["aria-label"] === ariaLabel,
  );
  expect(select, `select "${ariaLabel}"`).not.toBeNull();
  const onChange = select?.props.onChange;
  expect(onChange).toBeTypeOf("function");
  (onChange as (event: ChangeEvent<HTMLSelectElement>) => void)({
    target: { value },
  } as ChangeEvent<HTMLSelectElement>);
}

function changeSearch(tree: ReactElement, value: string): void {
  const search = findElement(
    tree,
    (element) => element.props.ariaLabel === "Search payment records",
  );
  expect(search).not.toBeNull();
  const onChange = search?.props.onChange;
  expect(onChange).toBeTypeOf("function");
  (onChange as (nextValue: string) => void)(value);
}

function togglePurchaseDetails(tree: ReactElement, purchaseId: string): void {
  const row = findElement(tree, (element) => {
    const candidate = element.props.row as
      | { id?: string }
      | undefined;
    return (
      candidate?.id === purchaseId &&
      typeof element.props.onToggle === "function" &&
      String(element.props.detailsId).includes("desktop-details")
    );
  });
  expect(row, `purchase row "${purchaseId}"`).not.toBeNull();
  (row?.props.onToggle as () => void)();
}

describe("ProducerPaymentWorkspace", () => {
  it("renders one compact multi-currency ledger and a grouped producer table", () => {
    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace buckets={buckets} scope="global" />,
    );

    expect(count(html, /Money at a glance/g)).toBe(1);
    expect(count(html, /<table/g)).toBe(1);
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
    expect(count(html, /scope="rowgroup"/g)).toBe(2);
    expect(count(html, /<tbody/g)).toBe(2);

    expect(html).toContain("USD");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("ILS");
    expect(html).toContain("₪2,000.00");

    const projectLinkIndex = html.indexOf(
      'href="/dashboard/clients-projects/project-usd"',
    );
    const purchaseRowIndex = html.indexOf("Mix &amp; master", projectLinkIndex);
    expect(projectLinkIndex).toBeGreaterThan(-1);
    expect(purchaseRowIndex).toBeGreaterThan(projectLinkIndex);

    expect(html).toContain(">Client</th>");
    expect(html).toContain("Maya Stone");
    expect(html).toContain('aria-label="Payment views"');
    expect(html).toContain('aria-label="Search payment records"');
    expect(html).toContain('aria-label="Filter by currency"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('href="/dashboard/payments/proof-pending"');

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("FULL DOSSIER SENTINEL");
    expect(html).not.toContain("Frozen terms");
  });

  it("exposes client-only all-records and project filters", () => {
    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace
        buckets={buckets}
        scope="client"
        clientLabel="Maya Stone"
      />,
    );

    expect(html).toContain("All records");
    expect(html).toContain('aria-label="Filter by project"');
    expect(html).toContain("<option");
    expect(html).toContain("Maya debut EP");
    expect(html).toContain("Noa single");
  });

  it("offers history instead of an inert clear action when no payments are open", () => {
    const historyOnlyBuckets: readonly PaymentWorkspaceBucket[] = [
      { id: "needs_review", label: "Needs review", projects: [] },
      { id: "due_or_overdue", label: "Due now", projects: [] },
      { id: "upcoming", label: "Upcoming", projects: [] },
      { id: "history", label: "History", projects: [ilsProject] },
    ];

    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace buckets={historyOnlyBuckets} scope="global" />,
    );

    expect(html).toContain("No open payments");
    expect(html).toContain("View history");
    expect(html).not.toContain(">Clear filters</button>");
  });

  it("renders one collapsed record tree per purchase in a 100-row ledger", () => {
    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace
        buckets={longLedgerBuckets(100)}
        scope="global"
      />,
    );

    expect(count(html, /aria-label="Show details for Long ledger purchase/g)).toBe(100);
    expect(html).not.toContain("FULL DOSSIER SENTINEL");
  });

  it("keeps every digit of extreme monetary values in wrappable money text", () => {
    const extremePurchase: PaymentHistoryPurchase = {
      ...ilsPurchase,
      id: "purchase-extreme",
      reference: "SK-EXTREME",
      title: "Extreme-value album",
      totalCents: 987_654_321,
      paidCents: 456_789_012,
      dueNowCents: 123_456_789,
      totalRemainingCents: 530_865_309,
      nextPayment: {
        amountCents: 123_456_789,
        dueAtIso: "2026-08-01T09:00:00.000Z",
        trigger: null,
      },
    };
    const extremeBuckets: readonly PaymentWorkspaceBucket[] = [
      {
        id: "due_or_overdue",
        label: "Due now",
        projects: [
          {
            ...ilsProject,
            id: "project-extreme",
            title: "Extreme-value project",
            purchases: [extremePurchase],
          },
        ],
      },
      { id: "needs_review", label: "Needs review", projects: [] },
      { id: "upcoming", label: "Upcoming", projects: [] },
      { id: "history", label: "History", projects: [] },
    ];

    const html = renderToStaticMarkup(
      <ProducerPaymentWorkspace buckets={extremeBuckets} scope="global" />,
    );

    for (const amount of [
      "₪4,567,890.12",
      "₪1,234,567.89",
      "₪5,308,653.09",
    ]) {
      expect(html).toContain(amount);
    }
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).not.toContain('data-payment-money-value="" class="whitespace-nowrap');
    expect(html).toContain("grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3");
    expect(html).toContain("order-3 col-span-6");
    expect(html).toContain("order-5 col-span-12");
  });

  it("executes status, currency, and search filters", () => {
    const statusHarness = createInteractionHarness({
      buckets,
      scope: "global",
    });
    clickButton(statusHarness.renderTree(), "Upcoming");
    const statusHtml = statusHarness.html();
    expect(statusHtml).toContain("Vocal production");
    expect(statusHtml).not.toContain("Mix &amp; master");
    expect(statusHtml).toContain("1 payment record");

    const currencyHarness = createInteractionHarness({
      buckets,
      scope: "global",
    });
    changeSelect(
      currencyHarness.renderTree(),
      "Filter by currency",
      "USD",
    );
    const currencyHtml = currencyHarness.html();
    expect(currencyHtml).toContain("Mix &amp; master");
    expect(currencyHtml).not.toContain("Vocal production");

    const searchHarness = createInteractionHarness({
      buckets,
      scope: "global",
    });
    changeSearch(searchHarness.renderTree(), "SK-ILS-202");
    const searchHtml = searchHarness.html();
    expect(searchHtml).toContain("Vocal production");
    expect(searchHtml).not.toContain("Mix &amp; master");
  });

  it("executes the client project filter and preserves the selected project href", () => {
    const harness = createInteractionHarness({
      buckets,
      scope: "client",
      clientLabel: "Maya Stone",
    });

    changeSelect(harness.renderTree(), "Filter by project", "project-ils");
    const html = harness.html();

    expect(html).toContain("Vocal production");
    expect(html).not.toContain("Mix &amp; master");
    expect(html).toContain('href="/dashboard/clients-projects/project-ils"');
    expect(html).not.toContain('href="/dashboard/clients-projects/project-usd"');
  });

  it("executes purchase detail expansion and collapse", () => {
    const harness = createInteractionHarness({
      buckets,
      scope: "global",
    });

    expect(harness.html()).not.toContain("FULL DOSSIER SENTINEL");

    togglePurchaseDetails(harness.renderTree(), "purchase-usd");
    const expandedHtml = harness.html();
    expect(expandedHtml).toContain("FULL DOSSIER SENTINEL");
    expect(expandedHtml).toContain('aria-expanded="true"');
    expect(expandedHtml).toContain("Hide details");

    togglePurchaseDetails(harness.renderTree(), "purchase-usd");
    const collapsedHtml = harness.html();
    expect(collapsedHtml).not.toContain("FULL DOSSIER SENTINEL");
    expect(collapsedHtml).toContain('aria-expanded="false"');
  });
});
