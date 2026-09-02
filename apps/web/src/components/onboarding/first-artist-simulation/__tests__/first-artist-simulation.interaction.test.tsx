// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FirstArtistSimulation } from "../first-artist-simulation";
import { PREVIEW_SIMULATION_INPUT, SIMULATION_LABEL } from "../simulation-model";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  capture: vi.fn<(name: string, properties?: Record<string, unknown>) => void>(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/onboarding/complete",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("~/components/runtime-state/online-required-link", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("~/lib/observability/product-events", () => ({
  captureProductEvent: mocks.capture,
}));

// The reused screens import their live server actions at module level. None
// may run during the simulation; the spies prove it.
const actionSpies = vi.hoisted(() => ({
  confirmPaymentProofAction: vi.fn(),
  rejectPaymentProofAction: vi.fn(),
  requestToBookAction: vi.fn(),
  acceptPurchaseAction: vi.fn(),
  cancelPaymentProofUploadAction: vi.fn(),
  presignProofUploadAction: vi.fn(),
  submitPaymentProofAction: vi.fn(),
  startManagedPaymentProofUpload: vi.fn(),
  uploadPaymentProofBytes: vi.fn(),
}));

vi.mock("~/app/(producer)/dashboard/payments/proof-actions", () => ({
  confirmPaymentProofAction: actionSpies.confirmPaymentProofAction,
  rejectPaymentProofAction: actionSpies.rejectPaymentProofAction,
}));

vi.mock("~/components/artist/purchase/actions", () => ({
  requestToBookAction: actionSpies.requestToBookAction,
  acceptPurchaseAction: actionSpies.acceptPurchaseAction,
  cancelPaymentProofUploadAction: actionSpies.cancelPaymentProofUploadAction,
  presignProofUploadAction: actionSpies.presignProofUploadAction,
  submitPaymentProofAction: actionSpies.submitPaymentProofAction,
}));

vi.mock("~/components/artist/purchase/proof-upload-lifecycle", () => ({
  startManagedPaymentProofUpload: actionSpies.startManagedPaymentProofUpload,
  uploadPaymentProofBytes: actionSpies.uploadPaymentProofBytes,
}));

const LINKS = {
  bringActiveWork: "/dashboard/clients-projects/bring-active-work",
  dashboard: "/dashboard?storeTip=1",
  publicUrl: "https://skitza.app/join/maya-stone",
};

function renderSimulation(input = PREVIEW_SIMULATION_INPUT) {
  const onOpenChange = vi.fn();
  render(<FirstArtistSimulation open onOpenChange={onOpenChange} input={input} links={LINKS} />);
  return { onOpenChange };
}

function dialog() {
  return screen.getByRole("dialog", { name: "Watch your first artist" });
}

function caption() {
  return within(dialog()).getByText(/·\s*Step \d+ of 10|Simulation over/).nextElementSibling;
}

function expectLabelledFrame() {
  expect(within(dialog()).getAllByText(SIMULATION_LABEL).length).toBeGreaterThan(0);
}

function artistFrame() {
  return within(dialog()).getByTestId("simulation-artist-frame");
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.capture.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  Object.values(actionSpies).forEach((spy) => {
    spy.mockReset();
  });
});

afterEach(() => {
  cleanup();
});

describe("FirstArtistSimulation", () => {
  it("plays the artist journey with the real product, then hands the producer the review", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderSimulation();

    // Step 1 — the Store as Noya sees it, with the producer's real product.
    expect(caption()?.textContent).toBe("Noya opens your link and sees your Store.");
    expectLabelledFrame();
    expect(artistFrame().hasAttribute("inert")).toBe(true);
    expect(within(artistFrame()).getAllByText("Signature production").length).toBeGreaterThan(0);
    expect(within(artistFrame()).getAllByText(/Maya Stone/).length).toBeGreaterThan(0);

    const next = () => user.click(within(dialog()).getByRole("button", { name: /^Next/ }));

    const artistCaptions = [
      "She reads what's included and taps Request.",
      "Her request lands in your Needs you.",
      "After your approval she picks a payment plan you offer.",
      "She accepts the exact agreement.",
      "She pays ₪900 straight to you by Bit or bank transfer.",
      "She uploads the transfer screenshot.",
    ];
    for (const expected of artistCaptions) {
      await next();
      expect(caption()?.textContent).toBe(expected);
      expectLabelledFrame();
      expect(artistFrame().hasAttribute("inert")).toBe(true);
      if (expected === "She accepts the exact agreement.") {
        expect(within(artistFrame()).getAllByText(/SK-SIM298/).length).toBeGreaterThan(0);
        expect(within(artistFrame()).queryByText(/development-gallery/)).toBeNull();
      }
    }

    // The payment frame shows the labelled example because no details were saved.
    expect(within(dialog()).queryByTestId("simulation-producer-panel")).toBeNull();

    // Step 8 — flip to the producer: the Needs-you row is a real control.
    await next();
    expect(caption()?.textContent).toBe("Back on your side. This is what lands in Needs you.");
    expectLabelledFrame();
    const panel = within(dialog()).getByTestId("simulation-producer-panel");
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(within(panel).getByText("Noya Levi sent a payment proof")).toBeTruthy();
    expect(within(panel).getByText(/₪900 of ₪1,800/)).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: /Review/ }));

    // Step 9 — the live producer review screen on its preview callback.
    expect(caption()?.textContent).toBe("Your turn: check the receipt and tap Confirm payment.");
    const review = within(dialog()).getByTestId("simulation-producer-panel");
    expect(within(review).getByRole("heading", { name: "Noya Levi" })).toBeTruthy();
    expect(within(review).getByText(/Blue Hour · Signature production/)).toBeTruthy();
    await user.click(within(review).getByRole("button", { name: "Confirm ₪900" }));
    await user.click(within(review).getByRole("button", { name: "Confirm payment" }));
    expect(within(review).getByText("Payment confirmed and recorded once.")).toBeTruthy();

    // Step 10 — the outcome, reached after the review shows its confirmed state.
    await waitFor(
      () => {
        expect(caption()?.textContent).toBe("Blue Hour is active. The headache is gone.");
      },
      { timeout: 3000 },
    );
    const outcome = within(dialog()).getByTestId("simulation-producer-panel");
    expect(within(outcome).getByText("Blue Hour is active")).toBeTruthy();
    expect(within(outcome).getByText("₪900 recorded")).toBeTruthy();
    expect(within(outcome).getByText("₪900 still to come")).toBeTruthy();
    expect(within(outcome).getByText("Downloads stay locked")).toBeTruthy();

    // Closing card — the real next steps.
    await user.click(within(dialog()).getByRole("button", { name: /^Finish/ }));
    expect(
      within(dialog()).getByText(
        "Noya Levi is not real. Who are you actually working with this week?",
      ),
    ).toBeTruthy();
    expect(
      within(dialog())
        .getByRole("link", { name: /Bring in your active work/ })
        .getAttribute("href"),
    ).toBe(LINKS.bringActiveWork);
    expect(
      within(dialog())
        .getByRole("link", { name: /Open dashboard/ })
        .getAttribute("href"),
    ).toBe(LINKS.dashboard);
    await user.click(within(dialog()).getByRole("button", { name: "Copy my link" }));
    // user-event installs its own clipboard stub, so read back what was written.
    await expect(navigator.clipboard.readText()).resolves.toBe(LINKS.publicUrl);
    expect(within(dialog()).getByRole("button", { name: "Link copied" })).toBeTruthy();

    // Nothing left the page.
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    Object.values(actionSpies).forEach((spy) => {
      expect(spy).not.toHaveBeenCalled();
    });

    // Telemetry tells the story in order.
    const names = mocks.capture.mock.calls.map(([name]) => name);
    expect(names[0]).toBe("simulation_started");
    expect(names.filter((name) => name === "simulation_step")).toHaveLength(10);
    expect(names.at(-1)).toBe("simulation_completed");
    expect(names).not.toContain("simulation_exited_early");
    fetchSpy.mockRestore();
  });

  it("shows the producer's own Bit details on the payment frame when they exist", async () => {
    const user = userEvent.setup();
    renderSimulation({
      ...PREVIEW_SIMULATION_INPUT,
      paymentDetails: { bitPhone: "052-123-4567", note: "Write Blue Hour in the note." },
    });

    for (let step = 1; step < 6; step += 1) {
      await user.click(within(dialog()).getByRole("button", { name: /^Next/ }));
    }
    expect(caption()?.textContent).toBe("She pays ₪900 straight to you by Bit or bank transfer.");
    expect(within(artistFrame()).getAllByText(/052-123-4567/).length).toBeGreaterThan(0);
    expect(within(artistFrame()).queryByText(/Example only/)).toBeNull();
  });

  it("reports an early exit with the step the producer left on", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderSimulation();

    await user.click(within(dialog()).getByRole("button", { name: /^Next/ }));
    fireEvent.keyDown(dialog(), { key: "ArrowRight" });
    expect(caption()?.textContent).toBe("Her request lands in your Needs you.");
    fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
    expect(caption()?.textContent).toBe("She reads what's included and taps Request.");

    await user.click(within(dialog()).getByRole("button", { name: "Close simulation" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.capture).toHaveBeenCalledWith("simulation_exited_early", {
      step: 2,
      frame: "detail",
    });
  });
});
