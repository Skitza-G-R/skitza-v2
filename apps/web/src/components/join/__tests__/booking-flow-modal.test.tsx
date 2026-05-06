import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

// BookingFlowTrigger — static-markup contract tests.
//
// vitest in this repo runs node-env (no jsdom), so we can only assert
// on server-rendered HTML. We exercise the children + className API,
// which is the contract that lets server-component callers (JoinHero,
// JoinNav, SignupCta) cross the RSC boundary safely.
//
// The modal itself stays portal-mounted under the closed state so the
// static-markup snapshot only contains the trigger button + an
// unmounted Radix Dialog Root (no overlay/content yet).

describe("BookingFlowTrigger", () => {
  it("renders children inside a button with the supplied className", () => {
    const html = renderToStaticMarkup(
      <BookingFlowTrigger
        slug="gili"
        producerName="Gili Studio"
        className="my-cta-class"
      >
        Book a session
      </BookingFlowTrigger>,
    );
    expect(html).toContain("Book a session");
    expect(html).toContain('class="my-cta-class"');
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
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
        className="dummy"
      >
        Open
      </BookingFlowTrigger>,
    );
    expect(html).not.toContain("Pick a slot");
    expect(html).not.toContain("Send booking request");
    expect(html).not.toContain("Step 1 of 3");
  });
});

// RSC invariant — the source MUST NOT accept a function prop.
//
// Why a static source check: vitest runs `BookingFlowTrigger` in one
// process with no server→client boundary, so `renderToStaticMarkup`
// happily rendered the broken render-prop API. Next's RSC runtime,
// which DOES enforce the boundary, was the only thing catching this
// — and it caught it in production at 2026-05-06T16:44Z, after the
// page shipped. See CLAUDE.md mistake log for the full incident.
//
// Pinning the no-function-prop invariant here means a future agent
// can't silently re-introduce a render-prop API on this client island
// and trigger the same prod outage.
describe("BookingFlowTrigger — RSC invariant", () => {
  it("does not declare any function-typed prop in its TypeScript interface", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      resolve(here, "..", "booking-flow-trigger.tsx"),
      "utf8",
    );

    // Pull just the interface body — anything outside it (file-level
    // comments mentioning the old render-prop, the function signature
    // of the component itself) is allowed to mention "() =>".
    const match = src.match(
      /interface\s+BookingFlowTriggerProps\s*\{([^}]*)\}/,
    );
    if (!match) {
      throw new Error("could not locate BookingFlowTriggerProps interface");
    }
    const body = match[1] ?? "";

    // No callback signatures. Server components passing functions to
    // this client island will fail at RSC serialization time with
    // "Functions cannot be passed directly to Client Components".
    expect(body).not.toMatch(/=>/);
    expect(body).not.toMatch(/\bFunction\b/);
  });
});
