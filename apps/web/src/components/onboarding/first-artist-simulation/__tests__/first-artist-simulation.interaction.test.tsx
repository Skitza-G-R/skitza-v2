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

vi.mock("~/components/runtime-state/online-required-link", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOnlineStatus: () => true,
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("~/lib/observability/product-events", () => ({
  captureProductEvent: mocks.capture,
}));

// Every live screen in the story imports its own server actions at module
// level. None may run during the simulation; these spies are the proof.
const actionSpies = vi.hoisted(() => ({
  confirmPaymentProofAction: vi.fn(),
  rejectPaymentProofAction: vi.fn(),
  approvePurchaseRequest: vi.fn(),
  declinePurchaseRequest: vi.fn(),
  correctPurchaseTarget: vi.fn(),
  acceptPurchaseAction: vi.fn(),
  requestToBookAction: vi.fn(),
  cancelPaymentProofUploadAction: vi.fn(),
  presignProofUploadAction: vi.fn(),
  submitPaymentProofAction: vi.fn(),
  confirmBookingAction: vi.fn(),
  rescheduleBookingAction: vi.fn(),
}));

vi.mock("~/app/(producer)/dashboard/payments/proof-actions", () => ({
  confirmPaymentProofAction: actionSpies.confirmPaymentProofAction,
  rejectPaymentProofAction: actionSpies.rejectPaymentProofAction,
}));

vi.mock("~/app/(producer)/dashboard/requests/actions", () => ({
  approvePurchaseRequest: actionSpies.approvePurchaseRequest,
  declinePurchaseRequest: actionSpies.declinePurchaseRequest,
  correctPurchaseTarget: actionSpies.correctPurchaseTarget,
}));

vi.mock("~/app/(artist)/artist/book/actions", () => ({
  confirmBookingAction: actionSpies.confirmBookingAction,
  rescheduleBookingAction: actionSpies.rescheduleBookingAction,
}));

vi.mock("~/components/artist/purchase/actions", () => ({
  requestToBookAction: actionSpies.requestToBookAction,
  acceptPurchaseAction: actionSpies.acceptPurchaseAction,
  cancelPaymentProofUploadAction: actionSpies.cancelPaymentProofUploadAction,
  presignProofUploadAction: actionSpies.presignProofUploadAction,
  submitPaymentProofAction: actionSpies.submitPaymentProofAction,
}));

const LINKS = {
  bringActiveWork: "/dashboard/clients-projects/bring-active-work",
  dashboard: "/dashboard",
  publicUrl: "https://skitza.app/join/maya-stone",
};

const WAIT = { timeout: 4000 } as const;

function renderSimulation(input = PREVIEW_SIMULATION_INPUT) {
  const onOpenChange = vi.fn();
  render(<FirstArtistSimulation open onOpenChange={onOpenChange} input={input} links={LINKS} />);
  return { onOpenChange };
}

function dialog() {
  return screen.getByRole("dialog", { name: "Watch your first artist" });
}

function caption() {
  return within(dialog()).queryByTestId("simulation-caption");
}

function stepCounter() {
  // The counter lives in the narration column, which the closing card replaces.
  return within(dialog()).queryByTestId("simulation-step")?.textContent ?? "";
}

function expectLabelledFrame() {
  expect(within(dialog()).getAllByText(SIMULATION_LABEL).length).toBeGreaterThan(0);
}

function artistFrame() {
  return within(dialog()).getByTestId("simulation-artist-frame");
}

function producerPanel() {
  return within(dialog()).getByTestId("simulation-producer-panel");
}

// jsdom has no matchMedia, and the live song page asks for it on mount.
// `matches: false` keeps reduced motion off, so the acted beat plays on its
// timer exactly as it does in a browser.
function installMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (media: string) =>
        ({
          matches: false,
          media,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) as MediaQueryList,
    ),
  );
}

beforeEach(() => {
  installMatchMedia();
  mocks.push.mockReset();
  mocks.replace.mockReset();
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
  it("plays the whole story through the live screens and never writes anything", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderSimulation();
    const next = () => user.click(within(dialog()).getByRole("button", { name: /^Next/ }));

    // 1 — the Store as Noya sees it, with the producer's real product.
    expect(caption()?.textContent).toBe("Noya opens your link and sees your Store.");
    expect(stepCounter()).toBe("1 / 8");
    expectLabelledFrame();
    // The screen is live: a producer judging what their artist gets can press it.
    expect(artistFrame().hasAttribute("inert")).toBe(false);
    expect(within(artistFrame()).getAllByText("Signature production").length).toBeGreaterThan(0);
    expect(within(artistFrame()).getAllByText(/Maya Stone/).length).toBeGreaterThan(0);

    // 2 — her request lands with the producer, on the live review screen.
    await next();
    expect(caption()?.textContent).toBe("She asks to book. It lands with you.");
    expect(stepCounter()).toBe("2 / 8");
    expectLabelledFrame();
    const approvePanel = producerPanel();
    expect(approvePanel.hasAttribute("inert")).toBe(false);
    expect(within(approvePanel).getByText(/asked to book/)).toBeTruthy();
    expect(within(approvePanel).getAllByText("Noya Levi").length).toBeGreaterThan(0);
    expect(within(approvePanel).getAllByText("₪1,800").length).toBeGreaterThan(0);
    const [approveButton] = within(approvePanel).getAllByRole("button", { name: "Approve" });
    if (!approveButton) throw new Error("no Approve button");
    await user.click(approveButton);
    // One tap decides. A nested dialog would open beneath this overlay and be
    // unreachable, which is exactly what the browser walk caught.
    expect(screen.queryByRole("dialog", { name: /Approve this request/ })).toBeNull();

    // 3 — she accepts the exact agreement; the frame plays the acceptance.
    await waitFor(() => {
      expect(caption()?.textContent).toBe("She accepts your exact agreement.");
    }, WAIT);
    expect(within(artistFrame()).getAllByText(/SK-SIM298/).length).toBeGreaterThan(0);
    expect(within(artistFrame()).queryByText(/development-gallery/)).toBeNull();
    // The frame plays the acceptance: the call to action only carries this
    // line once the agreement is accepted. Role queries cannot reach inside an
    // aria-hidden storyboard, so the assertions here read its text.
    await waitFor(() => {
      expect(
        within(artistFrame()).getByText("Creates the purchase with these frozen terms"),
      ).toBeTruthy();
    }, WAIT);

    // 4 — she pays, with the producer's own details or a labelled example.
    await next();
    expect(caption()?.textContent).toBe(
      "She pays ₪900 straight to you and sends the receipt.",
    );
    expect(within(dialog()).queryByTestId("simulation-producer-panel")).toBeNull();

    // 5 — the producer verifies the receipt on the live review screen.
    await next();
    expect(caption()?.textContent).toBe("You check the receipt and confirm.");
    const review = producerPanel();
    expect(within(review).getByRole("heading", { name: "Noya Levi" })).toBeTruthy();
    expect(within(review).getByText(/Blue Hour · Signature production/)).toBeTruthy();
    await user.click(within(review).getByRole("button", { name: "Confirm ₪900" }));
    await user.click(within(review).getByRole("button", { name: "Confirm payment" }));

    // 6 — her song, her note at 0:42, then she approves the exact version.
    await waitFor(() => {
      expect(caption()?.textContent).toBe(
        "Her song lives here, and she comments on the exact second.",
      );
    }, WAIT);
    expect(within(artistFrame()).getAllByText("Blue Hour").length).toBeGreaterThan(0);
    // Her note and the producer's reply, timestamped on the exact second.
    expect(artistFrame().querySelectorAll('[data-test="comment-timestamp"]')).toHaveLength(2);
    expect(
      Array.from(artistFrame().querySelectorAll('[data-test="comment-timestamp"]')).map(
        (node) => node.textContent,
      ),
    ).toEqual(["0:42", "0:42"]);
    expect(
      within(artistFrame()).getByText("This is the take. Keep the vocal exactly like this."),
    ).toBeTruthy();
    expect(artistFrame().querySelector('[data-test="approve-final-version"]')).toBeTruthy();
    await waitFor(() => {
      expect(artistFrame().querySelector('[data-test="artist-approved-status"]')).toBeTruthy();
    }, WAIT);

    // 7 — she books her own studio time out of the producer's hours.
    await next();
    expect(caption()?.textContent).toBe("She books her own studio time.");
    await waitFor(() => {
      expect(within(artistFrame()).getByText("You're booked")).toBeTruthy();
    }, WAIT);
    expect(within(artistFrame()).getAllByText(/Sessions/).length).toBeGreaterThan(0);

    // 8 — the producer's own dashboard, awake.
    await next();
    expect(caption()?.textContent).toBe("And this is your studio now.");
    expect(stepCounter()).toBe("8 / 8");
    const overview = producerPanel();
    expect(within(overview).getByText(/approved Blue Hour v2/)).toBeTruthy();
    expect(within(overview).getAllByText(/Active projects/).length).toBeGreaterThan(0);
    expect(within(overview).getByText("Payment due")).toBeTruthy();
    expect(within(overview).queryByText(/Nothing needs you right now/)).toBeNull();

    // Closing card — the real next steps; the caption gives way to the card.
    await user.click(within(dialog()).getByRole("button", { name: /^Finish/ }));
    expect(caption()).toBeNull();
    expect(stepCounter()).toBe("");
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
    expect(names.filter((name) => name === "simulation_step")).toHaveLength(8);
    expect(names.at(-1)).toBe("simulation_completed");
    expect(names).not.toContain("simulation_exited_early");
    fetchSpy.mockRestore();
    // The walk plays three acted beats and two decision beats on real timers.
  }, 30_000);

  it("lets the producer press the artist's own screens, and still writes nothing", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderSimulation();
    const next = () => user.click(within(dialog()).getByRole("button", { name: /^Next/ }));

    // Straight to the agreement, and accept it by hand rather than waiting.
    await next();
    const [approveButton] = within(producerPanel()).getAllByRole("button", { name: "Approve" });
    if (!approveButton) throw new Error("no Approve button");
    await user.click(approveButton);
    await waitFor(() => {
      expect(caption()?.textContent).toBe("She accepts your exact agreement.");
    }, WAIT);

    // The screen is live, so role queries reach inside it and clicks land.
    const agreement = artistFrame();
    await user.click(within(agreement).getByRole("checkbox"));
    await user.click(within(agreement).getByRole("button", { name: /Accept exact agreement/ }));
    await waitFor(() => {
      expect(caption()?.textContent).toBe(
        "She pays ₪900 straight to you and sends the receipt.",
      );
    }, WAIT);

    // Her "I've paid" button moves the story on instead of navigating.
    await user.click(within(artistFrame()).getByRole("button", { name: /upload proof/i }));
    await waitFor(() => {
      expect(caption()?.textContent).toBe("You check the receipt and confirm.");
    }, WAIT);

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    Object.values(actionSpies).forEach((spy) => {
      expect(spy).not.toHaveBeenCalled();
    });
    fetchSpy.mockRestore();
  }, 30_000);

  it("drops the booking frame when the product includes no studio time", async () => {
    const user = userEvent.setup();
    renderSimulation({
      ...PREVIEW_SIMULATION_INPUT,
      product: { ...PREVIEW_SIMULATION_INPUT.product, durationMin: 0, sessionCount: 0 },
    });

    expect(stepCounter()).toBe("1 / 7");
    for (let step = 0; step < 4; step += 1) {
      await user.click(within(dialog()).getByRole("button", { name: /^Next|^Finish/ }));
    }
    // Store, approve, agreement, pay, verify — the story skips straight from
    // her song to the dashboard.
    expect(caption()?.textContent).toBe("You check the receipt and confirm.");
  });

  it("shows the producer's own Bit details on the payment frame when they exist", async () => {
    const user = userEvent.setup();
    renderSimulation({
      ...PREVIEW_SIMULATION_INPUT,
      paymentDetails: { bitPhone: "052-123-4567", note: "Write Blue Hour in the note." },
    });

    for (let step = 0; step < 3; step += 1) {
      await user.click(within(dialog()).getByRole("button", { name: /^Next/ }));
    }
    expect(caption()?.textContent).toBe(
      "She pays ₪900 straight to you and sends the receipt.",
    );
    expect(within(artistFrame()).getAllByText(/052-123-4567/).length).toBeGreaterThan(0);
    expect(within(artistFrame()).queryByText(/Example only/)).toBeNull();
  });

  it("reports an early exit with the step the producer left on", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderSimulation();

    await user.click(within(dialog()).getByRole("button", { name: /^Next/ }));
    fireEvent.keyDown(dialog(), { key: "ArrowRight" });
    expect(caption()?.textContent).toBe("She accepts your exact agreement.");
    fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
    expect(caption()?.textContent).toBe("She asks to book. It lands with you.");

    await user.click(within(dialog()).getByRole("button", { name: "Close simulation" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.capture).toHaveBeenCalledWith("simulation_exited_early", {
      step: 2,
      frame: "approve",
    });
  });
});
