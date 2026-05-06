import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the server-action import so the static-markup render doesn't
// try to bundle "use server" wiring under the node-env test runner.
vi.mock("../booking-actions", () => ({
  fetchPublicProducts: vi.fn(),
  fetchPublicSlots: vi.fn(),
  requestPublicBooking: vi.fn(),
}));

import { BookingFlowTrigger } from "../booking-flow-trigger";

// Booking flow trigger + modal — static-markup contract tests.
//
// vitest in this repo runs node-env (no jsdom), so we can only assert
// on server-rendered HTML. We exercise the trigger's render-prop
// contract: a parent passes a button-like element, and the trigger
// renders it. The modal itself stays portal-mounted under the closed
// state so the static-markup snapshot only contains the trigger
// element + an unmounted Radix Dialog Root (no overlay/content yet).

describe("BookingFlowTrigger", () => {
  it("renders the parent-supplied trigger element", () => {
    const html = renderToStaticMarkup(
      <BookingFlowTrigger
        slug="gili"
        producerName="Gili Studio"
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick} data-testid="open-booking">
            Book a session
          </button>
        )}
      />,
    );
    expect(html).toContain("Book a session");
    expect(html).toContain('data-testid="open-booking"');
  });

  it("does NOT render the modal content while closed (portal stays empty)", () => {
    // The Radix Dialog Root exposes children only when `open=true` is
    // passed. Trigger initialises with open=false, so the modal copy
    // ("Pick a slot", "Send booking request") must not appear in the
    // initial server render. This protects the public route group
    // from leaking modal-only strings into the SSR HTML when the
    // visitor lands on the page.
    const html = renderToStaticMarkup(
      <BookingFlowTrigger
        slug="gili"
        producerName="Gili Studio"
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
      />,
    );
    expect(html).not.toContain("Pick a slot");
    expect(html).not.toContain("Send booking request");
    expect(html).not.toContain("Step 1 of 3");
  });
});
