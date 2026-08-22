import { describe, expect, it } from "vitest";

import type { PaymentHistoryProject, PaymentHistoryPurchase } from "../payment-history-view";
import {
  buildPaymentWorkspaceRows,
  filterPaymentWorkspaceRows,
  groupPaymentWorkspaceRows,
  isPaymentWorkspaceDateRangeValid,
  summarizePaymentWorkspaceRows,
  workspaceViewCount,
  type PaymentWorkspaceBucket,
  type PaymentWorkspaceBucketId,
  type PaymentWorkspaceRow,
} from "../producer-payment-workspace-model";

function purchase(
  id: string,
  overrides: Partial<PaymentHistoryPurchase> = {},
): PaymentHistoryPurchase {
  return {
    id,
    reference: `REF-${id}`,
    title: `Purchase ${id}`,
    counterpartyLabel: null,
    currency: "USD",
    status: { label: "Upcoming", tone: "active" },
    paidCents: 0,
    dueNowCents: 0,
    totalRemainingCents: 0,
    nextPayment: null,
    ...overrides,
  } as PaymentHistoryPurchase;
}

function project(
  id: string,
  title: string,
  purchases: readonly PaymentHistoryPurchase[],
): PaymentHistoryProject {
  return {
    id,
    title,
    status: { label: "Active", tone: "active" },
    currencyTotals: [],
    purchases,
  };
}

function row(
  bucketId: PaymentWorkspaceBucketId,
  payment: PaymentHistoryPurchase,
  parentProject = project(`project-${payment.id}`, `Project ${payment.id}`, [payment]),
): PaymentWorkspaceRow {
  return {
    id: payment.id,
    bucketId,
    project: parentProject,
    purchase: payment,
  };
}

const allFilters = {
  view: "all" as const,
  query: "",
  currency: "all",
  projectId: "all",
  counterpartyId: "all",
  establishedFrom: "",
  establishedTo: "",
};

describe("producer payment workspace model", () => {
  it("attaches every purchase to its exact project and defensively deduplicates purchase ids", () => {
    const firstPurchase = purchase("shared");
    const firstProject = project("project-a", "Album A", [firstPurchase]);
    const duplicateProject = project("project-b", "Album B", [
      purchase("shared", { title: "Duplicate projection" }),
      purchase("unique"),
    ]);
    const buckets: PaymentWorkspaceBucket[] = [
      {
        id: "needs_review",
        label: "Needs review",
        projects: [firstProject],
      },
      {
        id: "upcoming",
        label: "Upcoming",
        projects: [duplicateProject],
      },
    ];

    const rows = buildPaymentWorkspaceRows(buckets);

    expect(
      rows.map(({ id, bucketId, project: attachedProject }) => ({
        id,
        bucketId,
        projectId: attachedProject.id,
      })),
    ).toEqual([
      { id: "shared", bucketId: "needs_review", projectId: "project-a" },
      { id: "unique", bucketId: "upcoming", projectId: "project-b" },
    ]);
    expect(rows[0]?.project).toBe(firstProject);
    expect(rows[0]?.purchase).toBe(firstPurchase);
  });

  it("supports all, open, and exact bucket views with matching counts", () => {
    const rows = [
      row("needs_review", purchase("review")),
      row("due_or_overdue", purchase("due")),
      row("upcoming", purchase("upcoming")),
      row("history", purchase("history")),
    ];

    expect(filterPaymentWorkspaceRows(rows, allFilters)).toHaveLength(4);
    expect(
      filterPaymentWorkspaceRows(rows, { ...allFilters, view: "open" }).map(({ id }) => id),
    ).toEqual(["review", "due", "upcoming"]);
    expect(
      filterPaymentWorkspaceRows(rows, { ...allFilters, view: "history" }).map(({ id }) => id),
    ).toEqual(["history"]);

    expect(workspaceViewCount(rows, "all")).toBe(4);
    expect(workspaceViewCount(rows, "open")).toBe(3);
    expect(workspaceViewCount(rows, "needs_review")).toBe(1);
  });

  it("uses case-insensitive token-AND search across project and purchase fields", () => {
    const matchingPurchase = purchase("matching", {
      title: "Vocal mix",
      reference: "SK-204",
      counterpartyLabel: "Maya Stone",
      status: { label: "Overdue", tone: "danger" },
    });
    const matchingProject = project("project-maya", "Debut Album", [matchingPurchase]);
    const rows = [
      row("due_or_overdue", matchingPurchase, matchingProject),
      row("upcoming", purchase("other", { counterpartyLabel: "Maya Stone" })),
    ];

    expect(
      filterPaymentWorkspaceRows(rows, {
        ...allFilters,
        query: "  DEBUT maya sk-204 OVERDUE  ",
      }).map(({ id }) => id),
    ).toEqual(["matching"]);
    expect(filterPaymentWorkspaceRows(rows, { ...allFilters, query: "maya paid" })).toEqual([]);
  });

  it("filters by exact currency and project", () => {
    const usdPurchase = purchase("usd", { currency: "USD" });
    const ilsPurchase = purchase("ils", { currency: "ILS" });
    const usdProject = project("usd-project", "USD work", [usdPurchase]);
    const ilsProject = project("ils-project", "ILS work", [ilsPurchase]);
    const rows = [
      row("upcoming", usdPurchase, usdProject),
      row("upcoming", ilsPurchase, ilsProject),
    ];

    expect(
      filterPaymentWorkspaceRows(rows, { ...allFilters, currency: "ILS" }).map(({ id }) => id),
    ).toEqual(["ils"]);
    expect(
      filterPaymentWorkspaceRows(rows, {
        ...allFilters,
        projectId: "usd-project",
      }).map(({ id }) => id),
    ).toEqual(["usd"]);
    expect(
      filterPaymentWorkspaceRows(rows, {
        ...allFilters,
        currency: "USD",
        projectId: "ils-project",
      }),
    ).toEqual([]);
  });

  it("composes an exact artist filter with an inclusive agreement-date range", () => {
    const mayaJuly = purchase("maya-july", {
      counterpartyId: "client-maya",
      counterpartyLabel: "Maya Stone",
      agreementRecord: {
        kind: "artist_acceptance",
        establishedAtIso: "2026-07-01T00:00:00.000Z",
        headline: "Maya Stone accepted the exact terms",
        statement: null,
      },
    });
    const duplicateName = purchase("other-maya", {
      counterpartyId: "client-other-maya",
      counterpartyLabel: "Maya Stone",
      agreementRecord: {
        kind: "producer_import",
        establishedAtIso: "2026-07-15T12:00:00.000Z",
        headline: "Added by producer from an existing agreement",
        statement: null,
      },
    });
    const mayaAugust = purchase("maya-august", {
      counterpartyId: "client-maya",
      counterpartyLabel: "Maya Stone",
      agreementRecord: {
        kind: "artist_acceptance",
        establishedAtIso: "2026-08-01T00:00:00.000Z",
        headline: "Maya Stone accepted the exact terms",
        statement: null,
      },
    });
    const rows = [
      row("history", mayaJuly),
      row("history", duplicateName),
      row("history", mayaAugust),
    ];

    expect(
      filterPaymentWorkspaceRows(rows, {
        ...allFilters,
        view: "history",
        counterpartyId: "client-maya",
        establishedFrom: "2026-07-01",
        establishedTo: "2026-07-31",
      }).map(({ id }) => id),
    ).toEqual(["maya-july"]);
  });

  it("includes both agreement-date boundaries and fails closed for invalid ranges", () => {
    const start = purchase("start", {
      agreementRecord: {
        kind: "artist_acceptance",
        establishedAtIso: "2026-07-01T00:00:00.000Z",
        headline: "Accepted agreement",
        statement: null,
      },
    });
    const end = purchase("end", {
      agreementRecord: {
        kind: "producer_import",
        establishedAtIso: "2026-07-31T23:59:59.999Z",
        headline: "Added by producer from an existing agreement",
        statement: null,
      },
    });
    const outside = purchase("outside", {
      agreementRecord: {
        kind: "artist_acceptance",
        establishedAtIso: "2026-08-01T00:00:00.000Z",
        headline: "Accepted agreement",
        statement: null,
      },
    });
    const rows = [row("upcoming", start), row("upcoming", end), row("upcoming", outside)];

    expect(
      filterPaymentWorkspaceRows(rows, {
        ...allFilters,
        establishedFrom: "2026-07-01",
        establishedTo: "2026-07-31",
      }).map(({ id }) => id),
    ).toEqual(["end", "start"]);
    expect(isPaymentWorkspaceDateRangeValid("2026-07-31", "2026-07-01")).toBe(false);
    expect(
      filterPaymentWorkspaceRows(rows, {
        ...allFilters,
        establishedFrom: "2026-07-31",
        establishedTo: "2026-07-01",
      }),
    ).toEqual([]);
  });

  it("sorts action first, overdue before due, nearest dates first, and text as a stable fallback", () => {
    const rows = [
      row("history", purchase("history-z"), project("z-history", "Zulu", [])),
      row("upcoming", purchase("upcoming-null")),
      row(
        "due_or_overdue",
        purchase("due-early", {
          status: { label: "Due", tone: "warning" },
          nextPayment: {
            amountCents: 100,
            dueAtIso: "2026-07-01T00:00:00.000Z",
            trigger: null,
          },
        }),
      ),
      row(
        "due_or_overdue",
        purchase("overdue-late", {
          status: { label: "Overdue", tone: "danger" },
          nextPayment: {
            amountCents: 100,
            dueAtIso: "2026-06-15T00:00:00.000Z",
            trigger: null,
          },
        }),
      ),
      row("needs_review", purchase("review")),
      row(
        "upcoming",
        purchase("upcoming-dated", {
          nextPayment: {
            amountCents: 100,
            dueAtIso: "2026-08-01T00:00:00.000Z",
            trigger: null,
          },
        }),
      ),
      row(
        "due_or_overdue",
        purchase("overdue-early", {
          status: { label: "Overdue", tone: "danger" },
          nextPayment: {
            amountCents: 100,
            dueAtIso: "2026-06-01T00:00:00.000Z",
            trigger: null,
          },
        }),
      ),
      row("history", purchase("history-a"), project("a-history", "Alpha", [])),
    ];

    expect(filterPaymentWorkspaceRows(rows, allFilters).map(({ id }) => id)).toEqual([
      "review",
      "overdue-early",
      "overdue-late",
      "due-early",
      "upcoming-dated",
      "upcoming-null",
      "history-a",
      "history-z",
    ]);
  });

  it("groups rows by project in sorted first-appearance order", () => {
    const firstProject = project("first", "First", []);
    const secondProject = project("second", "Second", []);
    const rows = [
      row("needs_review", purchase("first-a"), firstProject),
      row("due_or_overdue", purchase("second-a"), secondProject),
      row("upcoming", purchase("first-b"), firstProject),
    ];

    const groups = groupPaymentWorkspaceRows(rows);

    expect(groups.map(({ project: groupedProject }) => groupedProject.id)).toEqual([
      "first",
      "second",
    ]);
    expect(groups[0]?.project).toBe(firstProject);
    expect(groups[0]?.rows.map(({ id }) => id)).toEqual(["first-a", "first-b"]);
  });

  it("summarizes unique purchases separately by currency", () => {
    const usd = purchase("usd", {
      currency: "USD",
      paidCents: 4_000,
      dueNowCents: 2_000,
      totalRemainingCents: 8_000,
    });
    const ils = purchase("ils", {
      currency: "ILS",
      paidCents: 15_000,
      dueNowCents: 7_000,
      totalRemainingCents: 25_000,
    });
    const rows = [row("needs_review", usd), row("history", ils), row("history", usd)];

    expect(summarizePaymentWorkspaceRows(rows)).toEqual({
      currencyTotals: [
        {
          currency: "ILS",
          paidCents: 15_000,
          dueNowCents: 7_000,
          totalRemainingCents: 25_000,
          purchaseCount: 1,
        },
        {
          currency: "USD",
          paidCents: 4_000,
          dueNowCents: 2_000,
          totalRemainingCents: 8_000,
          purchaseCount: 1,
        },
      ],
      totalCount: 2,
      openCount: 1,
      needsReviewCount: 1,
    });
  });
});
