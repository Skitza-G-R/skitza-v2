// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PurchaseRequestReview } from "../purchase-request-review";

// SK-298: the onboarding simulation renders this screen for real, so the
// preview seam must take the decision instead of the server action. These
// spies are the proof that nothing reaches the database.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  approvePurchaseRequest: vi.fn(),
  declinePurchaseRequest: vi.fn(),
  correctPurchaseTarget: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: vi.fn(),
    refresh: mocks.refresh,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("~/app/(producer)/dashboard/requests/actions", () => ({
  approvePurchaseRequest: mocks.approvePurchaseRequest,
  declinePurchaseRequest: mocks.declinePurchaseRequest,
  correctPurchaseTarget: mocks.correctPurchaseTarget,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

function renderReview(onPreviewDecision?: (decision: "approve" | "decline") => void) {
  render(
    <PurchaseRequestReview
      id="00000000-0000-4000-8000-000000000001"
      initialStatus="pending"
      initialProjectId={null}
      targetProjects={[]}
      artistName="Noya Levi"
      artistEmail="noya.levi@skitza.invalid"
      productName="Signature production"
      total="₪1,800"
      totalCaption="Proposal total"
      submittedAt="Sep 2, 2026, 11:00 AM"
      reference="SK-SIM298"
      brief="Debut single. Warm, live drums if we can."
      {...(onPreviewDecision ? { onPreviewDecision } : {})}
    >
      <div data-testid="commercial-details" />
    </PurchaseRequestReview>,
  );
}

/** The screen renders a desktop aside and a mobile action bar; either is fine. */
async function decide(user: ReturnType<typeof userEvent.setup>, label: "Approve" | "Decline") {
  // The screen renders the decision twice: a desktop aside and a mobile bar.
  const [trigger] = screen.getAllByRole("button", { name: label });
  if (!trigger) throw new Error(`no ${label} button`);
  await user.click(trigger);
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: `${label} request` }));
}

beforeEach(() => {
  Object.values(mocks).forEach((spy) => {
    spy.mockReset();
  });
});

afterEach(() => {
  cleanup();
});

describe("PurchaseRequestReview preview seam (SK-298)", () => {
  it("hands an approval to the caller and never runs the server action", async () => {
    const user = userEvent.setup();
    const onPreviewDecision = vi.fn();
    renderReview(onPreviewDecision);

    await decide(user, "Approve");

    expect(onPreviewDecision).toHaveBeenCalledExactlyOnceWith("approve");
    expect(screen.getByText("Request approved")).toBeTruthy();
    expect(mocks.approvePurchaseRequest).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    // The decision buttons are gone once the request leaves "pending".
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("hands a decline to the caller and never runs the server action", async () => {
    const user = userEvent.setup();
    const onPreviewDecision = vi.fn();
    renderReview(onPreviewDecision);

    await decide(user, "Decline");

    expect(onPreviewDecision).toHaveBeenCalledExactlyOnceWith("decline");
    expect(screen.getByText("Request declined")).toBeTruthy();
    expect(mocks.declinePurchaseRequest).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("still runs the real approval when no preview seam is supplied", async () => {
    const user = userEvent.setup();
    mocks.approvePurchaseRequest.mockResolvedValue({ ok: true, status: "approved" });
    renderReview();

    await decide(user, "Approve");

    expect(mocks.approvePurchaseRequest).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000001",
    });
  });
});
