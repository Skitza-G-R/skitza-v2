// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import type { PaymentHistoryViewData } from "~/components/payments/payment-history-view";

import { PaymentsTab, type ProjectPaymentsTabData } from "../project-payments-tab";

vi.mock("~/components/payments/payment-history-view", () => ({
  PaymentHistoryView: ({ data }: { data: PaymentHistoryViewData }) => (
    <div data-testid={`payment-section-${data.section.id}`}>{data.section.title}</div>
  ),
}));

vi.mock("~/components/dashboard/projects/project-purchases-panel", () => ({
  ProjectPurchasesPanel: () => <div data-testid="purchases-panel">Purchases &amp; add-ons</div>,
}));

const dialogSpy = vi.fn();
vi.mock("~/components/dashboard/payments/record-payment-dialog", () => ({
  RecordPaymentDialog: (props: { initialFile: File | null }) => {
    dialogSpy(props.initialFile);
    return <div data-testid="record-payment-dialog" />;
  },
}));

const finalPaymentSpy = vi.fn();
vi.mock("~/components/dashboard/payments/request-final-payment-card", () => ({
  RequestFinalPaymentCard: (props: { purchase: { id: string } }) => {
    finalPaymentSpy(props.purchase.id);
    return <div data-testid="request-final-payment">The work is done</div>;
  },
}));

const toast = vi.fn();
vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast, dismissToast: vi.fn() }),
}));

function openPurchase(overrides: Partial<ProjectPurchaseSummary> = {}): ProjectPurchaseSummary {
  return {
    id: "p1",
    sourceKind: "store_product",
    sourceLabel: "Full production",
    lifecycleStatus: "active",
    totalCents: 50_000,
    currency: "ILS",
    installments: [
      {
        id: "i1",
        position: 1,
        amountCents: 50_000,
        currency: "ILS",
        dueAtIso: "2026-08-01T09:00:00.000Z",
        status: "not_paid",
        remainingCents: 50_000,
        hasPendingProof: false,
        payableNow: true,
      },
    ],
    ...overrides,
  };
}

function fileDrag(file: File | null) {
  return {
    dataTransfer: {
      types: ["Files"],
      files: file ? [file] : [],
      dropEffect: "none",
    },
  };
}

function paymentView(id: string, title: string, hasPurchases: boolean): PaymentHistoryViewData {
  return {
    section: {
      id,
      eyebrow: "Payments",
      title,
      description: title,
      emptyTitle: "Empty",
      emptyDescription: "Empty",
    },
    currencyTotals: [],
    projects: hasPurchases
      ? ([
          {
            id: `${id}-project`,
            title: "Project",
            purchases: [{ id: `${id}-purchase` }],
          },
        ] as unknown as PaymentHistoryViewData["projects"])
      : [],
  };
}

function paymentData(
  states: Partial<Record<keyof ProjectPaymentsTabData, boolean>> = {},
): ProjectPaymentsTabData {
  return {
    needsReview: paymentView("needs-review", "Pending proofs", states.needsReview ?? false),
    dueOrOverdue: paymentView("due", "Outstanding payments", states.dueOrOverdue ?? false),
    history: paymentView("history", "Payment history", states.history ?? false),
  };
}

afterEach(() => {
  cleanup();
  dialogSpy.mockClear();
  finalPaymentSpy.mockClear();
  toast.mockClear();
});

describe("PaymentsTab", () => {
  it("renders action buckets first, purchases next, and completed history last", () => {
    const { container } = render(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData({
          needsReview: true,
          dueOrOverdue: true,
          history: true,
        })}
        purchases={[]}
      />,
    );

    const text = container.textContent;
    expect(text.indexOf("Pending proofs")).toBeLessThan(text.indexOf("Outstanding payments"));
    expect(text.indexOf("Outstanding payments")).toBeLessThan(text.indexOf("Purchases & add-ons"));
    expect(text.indexOf("Purchases & add-ons")).toBeLessThan(
      text.indexOf("Completed payment history"),
    );

    const history = screen.getByText("Completed payment history").closest("details");
    expect(history?.hasAttribute("open")).toBe(false);
  });

  it("shows a calm action state while preserving purchases when nothing is due", () => {
    render(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData({ history: true })}
        purchases={[]}
      />,
    );

    expect(screen.getByText("No payments need attention.")).not.toBeNull();
    expect(screen.getByTestId("purchases-panel")).not.toBeNull();
    expect(screen.queryByTestId("payment-section-needs-review")).toBeNull();
    expect(screen.queryByTestId("payment-section-due")).toBeNull();
  });

  it("offers Record a payment only while an installment is open", () => {
    const { rerender } = render(
      <PaymentsTab projectId="project-1" payments={paymentData()} purchases={[openPurchase()]} />,
    );
    expect(screen.getByText("1 payment open")).not.toBeNull();
    expect(screen.getByText(/₪500 left on this project/)).not.toBeNull();
    expect(screen.queryByTestId("record-payment-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Record a payment" }));
    expect(screen.getByTestId("record-payment-dialog")).not.toBeNull();
    expect(dialogSpy).toHaveBeenLastCalledWith(null);

    rerender(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData()}
        purchases={[
          openPurchase({
            installments: [
              {
                id: "i1",
                position: 1,
                amountCents: 50_000,
                currency: "ILS",
                dueAtIso: "2026-08-01T09:00:00.000Z",
                status: "confirmed",
                remainingCents: 0,
                hasPendingProof: false,
                payableNow: false,
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Record a payment" })).toBeNull();
    expect(screen.getByText("Nothing is waiting for payment")).not.toBeNull();
  });

  // SK-293 — the dead end: every payment settled except the 50/50 final half,
  // which waits on an approval the client will never give. The tab used to say
  // "Record it here once a payment is due" and offer no button at all.
  it("still offers Record a payment when only the unapproved final half is left", () => {
    render(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData()}
        purchases={[
          openPurchase({
            installments: [
              {
                id: "i1",
                position: 1,
                amountCents: 25_000,
                currency: "ILS",
                dueAtIso: "2026-08-01T09:00:00.000Z",
                status: "confirmed",
                remainingCents: 0,
                hasPendingProof: false,
                payableNow: false,
              },
              {
                id: "i2",
                position: 2,
                amountCents: 25_000,
                currency: "ILS",
                dueAtIso: null,
                status: "not_paid",
                remainingCents: 25_000,
                hasPendingProof: false,
                payableNow: false,
                finalMilestonePending: true,
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Record a payment" })).not.toBeNull();
    // Not due, so it must not be counted as money the client owes today.
    expect(screen.queryByText(/payments? open/)).toBeNull();
    expect(screen.getByText("Nothing is due yet")).not.toBeNull();
    expect(screen.getByText(/You can still record it/)).not.toBeNull();
    // The standalone finished-work card stays imported-work-only.
    expect(screen.queryByTestId("request-final-payment")).toBeNull();
  });

  it("opens the form with a dropped receipt attached and rejects other files", () => {
    render(
      <PaymentsTab projectId="project-1" payments={paymentData()} purchases={[openPurchase()]} />,
    );
    const panel = screen.getByRole("tabpanel");

    fireEvent.dragEnter(panel, fileDrag(null));
    expect(panel.getAttribute("data-drop-active")).toBe("true");
    expect(screen.getByText("Drop the receipt to record a payment")).not.toBeNull();

    const wav = new File(["x"], "mix.wav", { type: "audio/wav" });
    fireEvent.drop(panel, fileDrag(wav));
    expect(panel.getAttribute("data-drop-active")).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/photo .* or a PDF/i), "error");
    expect(screen.queryByTestId("record-payment-dialog")).toBeNull();

    const receipt = new File(["x"], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.dragEnter(panel, fileDrag(null));
    fireEvent.drop(panel, fileDrag(receipt));
    expect(screen.getByTestId("record-payment-dialog")).not.toBeNull();
    expect(dialogSpy).toHaveBeenLastCalledWith(receipt);
  });

  // SK-269 — imported work whose last half waits on an approval the client
  // will never give. The producer needs the way out right where the money is.
  it("offers the finished-work control only for a purchase the server allows", () => {
    const { rerender } = render(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData()}
        purchases={[
          openPurchase({
            id: "imported-1",
            sourceKind: "imported_existing_work",
            finalPaymentRequest: { installmentId: "i2", amountCents: 25_000 },
          }),
        ]}
      />,
    );

    const text = screen.getByRole("tabpanel").textContent;
    expect(screen.getByTestId("request-final-payment")).not.toBeNull();
    expect(finalPaymentSpy).toHaveBeenCalledWith("imported-1");
    expect(text.indexOf("The work is done")).toBeLessThan(text.indexOf("1 payment open"));

    rerender(
      <PaymentsTab
        projectId="project-1"
        payments={paymentData()}
        purchases={[openPurchase({ id: "imported-1", sourceKind: "imported_existing_work" })]}
      />,
    );
    expect(screen.queryByTestId("request-final-payment")).toBeNull();
  });

  it("ignores drags when nothing can be recorded", () => {
    render(<PaymentsTab projectId="project-1" payments={paymentData()} purchases={[]} />);
    const panel = screen.getByRole("tabpanel");
    fireEvent.dragEnter(panel, fileDrag(null));
    expect(panel.getAttribute("data-drop-active")).toBeNull();
  });
});
