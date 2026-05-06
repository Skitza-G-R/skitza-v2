import { describe, expect, test } from "vitest";

import { appRouter } from "../_app";

// Layer 1 of the /join booking-gate fix (2026-05-06).
//
// The previous v3-clean shape exposed four `publicProcedure` entries on
// the booking router (`publicRequest`, `publicSlots`, `publicProducts`,
// `publicPackages`) so the inline 3-step booking modal at /join/<slug>
// could read a producer's products + open slots and POST a `pending`
// booking — all without the visitor ever signing up. That surface was
// the bug Gili reported: anyone could book "from the page" with no
// auth step.
//
// Layer 1 removes those four procedures and routes the "Book a session"
// CTAs back to /sign-up/join/<slug>. This test pins the negative
// invariant — if any of the four ever come back, this test fails and
// stops the regression at CI before it ships to prod.
//
// Why a NOT_FOUND assertion (not `.toBeUndefined()`): tRPC v11's
// createCaller is backed by a Proxy that returns a callable for any
// property access — so `caller.booking.publicRequest` is *truthy*
// regardless of whether the route exists. The Proxy only resolves to
// NOT_FOUND when the call is actually invoked. A behavior-level
// assertion (call → rejects with NOT_FOUND) is precise: a procedure
// that exists would fail at Zod input validation (BAD_REQUEST), not
// NOT_FOUND, so this test catches both deletion AND silent
// re-introduction of any of the four.

const REMOVED_PROCEDURES = [
  "publicRequest",
  "publicSlots",
  "publicProducts",
  "publicPackages",
] as const;

describe("booking router — unauthenticated surface", () => {
  test.each(REMOVED_PROCEDURES)(
    "booking.%s is removed from the unauth surface",
    async (procedureName) => {
      const caller = appRouter.createCaller({ userId: null });
      // tRPC v11's createCaller is a Proxy that returns a callable for any
      // path access (the call resolves NOT_FOUND at invocation, not access).
      // The defensive throw is unreachable in practice — it documents the
      // proxy contract and keeps strict-mode TS + ESLint happy.
      const bookingProxy = caller.booking as unknown as Record<
        string,
        (input: unknown) => Promise<unknown>
      >;
      const proc = bookingProxy[procedureName];
      if (!proc) throw new Error("tRPC proxy returns a callable for any property");

      await expect(proc({})).rejects.toMatchObject({ code: "NOT_FOUND" });
    },
  );
});
