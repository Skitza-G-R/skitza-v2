// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";

type AnyAction = (input: unknown) => Promise<unknown>;

const refresh = vi.fn();
const toast = vi.fn();
const requestFinalPayment = vi.fn<AnyAction>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast, dismissToast: vi.fn() }),
}));
vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));
vi.mock("~/app/(producer)/dashboard/clients-projects/actions", () => ({
  requestFinalPaymentAction: (input: unknown) => requestFinalPayment(input),
}));

import { RequestFinalPaymentCard } from "../request-final-payment-card";

const IMPORTED: ProjectPurchaseSummary = {
  id: "purchase-1",
  sourceKind: "imported_existing_work",
  sourceLabel: "Album — 6 songs",
  lifecycleStatus: "active",
  totalCents: 500_000,
  currency: "ILS",
  installments: [],
  finalPaymentRequest: { installmentId: "installment-2", amountCents: 250_000 },
};

function renderCard() {
  return render(
    <RequestFinalPaymentCard
      projectId="project-1"
      purchase={IMPORTED}
      request={{ installmentId: "installment-2", amountCents: 250_000 }}
    />,
  );
}

afterEach(() => {
  cleanup();
  refresh.mockClear();
  toast.mockClear();
  requestFinalPayment.mockReset();
});

describe("RequestFinalPaymentCard", () => {
  it("says plainly what is waiting and for how much", () => {
    renderCard();
    expect(screen.getByText("The last payment is waiting")).not.toBeNull();
    expect(screen.getByText(/₪2,500 for Album — 6 songs/)).not.toBeNull();
  });

  it("never asks for the payment without a confirmation", () => {
    renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: /The work is done — ask for the final payment/ }),
    );

    expect(requestFinalPayment).not.toHaveBeenCalled();
    expect(screen.getByText("Ask for the final payment?")).not.toBeNull();
    expect(screen.getByText("This cannot be undone.")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(requestFinalPayment).not.toHaveBeenCalled();
  });

  it("asks for exactly the installment it offered, then refreshes", async () => {
    requestFinalPayment.mockResolvedValue({ ok: true });
    renderCard();

    fireEvent.click(
      screen.getByRole("button", { name: /The work is done — ask for the final payment/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Yes, the work is done/ }));

    await waitFor(() => {
      expect(requestFinalPayment).toHaveBeenCalledWith({
        projectId: "project-1",
        purchaseId: "purchase-1",
        installmentId: "installment-2",
      });
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(toast).toHaveBeenCalledWith("₪2,500 is now due", "success");
  });

  it("shows the server's refusal instead of pretending it worked", async () => {
    requestFinalPayment.mockResolvedValue({
      ok: false,
      error: "Only imported work can be marked finished here.",
    });
    renderCard();

    fireEvent.click(
      screen.getByRole("button", { name: /The work is done — ask for the final payment/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Yes, the work is done/ }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        "Only imported work can be marked finished here.",
        "error",
      );
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
