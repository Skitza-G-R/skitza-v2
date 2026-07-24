import { describe, expect, it } from "vitest";

import {
  createWaitingWorkerMarker,
  isProtectedNativeActionPath,
  parseWaitingWorkerMarker,
  shouldRequestSafeActivation,
  type SafeReopenDecision,
} from "../update-coordination";

const SAFE_REOPEN: SafeReopenDecision = {
  waitingWorkerFound: true,
  waitingVersionWasObservedBeforeBoot: true,
  pathname: "/dashboard",
  visibilityState: "visible",
  online: true,
  interactionObserved: false,
  protectedActionActive: false,
  blockingDomState: false,
};

describe("waiting worker coordination", () => {
  it("requests activation only for the same worker observed before this boot", () => {
    expect(shouldRequestSafeActivation(SAFE_REOPEN)).toBe(true);
    expect(
      shouldRequestSafeActivation({
        ...SAFE_REOPEN,
        waitingVersionWasObservedBeforeBoot: false,
      }),
    ).toBe(false);
    expect(
      shouldRequestSafeActivation({
        ...SAFE_REOPEN,
        waitingWorkerFound: false,
      }),
    ).toBe(false);
  });

  it.each([
    { pathname: "/artist/payments/purchase-1" },
    { pathname: "/dashboard/calendar/booking/1" },
    { pathname: "/dashboard/calendar" },
    { pathname: "/dashboard/music" },
    { pathname: "/onboarding/profile" },
    { pathname: "/sign-in" },
    { visibilityState: "hidden" as const },
    { online: false },
    { interactionObserved: true },
    { protectedActionActive: true },
    { blockingDomState: true },
  ])("blocks takeover for unsafe state %#", (override) => {
    expect(
      shouldRequestSafeActivation({ ...SAFE_REOPEN, ...override }),
    ).toBe(false);
  });

  it.each([
    "/artist/payments/1",
    "/dashboard/bookings",
    "/dashboard/music/song-1",
    "/artist/proofs/upload",
    "/listen/private-token",
  ])("recognizes protected action route %s", (pathname) => {
    expect(isProtectedNativeActionPath(pathname)).toBe(true);
  });

  it("persists and validates an exact waiting-worker version marker", () => {
    const serialized = createWaitingWorkerMarker("skitza-sw-v4");
    expect(parseWaitingWorkerMarker(serialized)).toMatchObject({
      version: "skitza-sw-v4",
    });
    expect(parseWaitingWorkerMarker('{"version":""}')).toBeNull();
    expect(parseWaitingWorkerMarker("not-json")).toBeNull();
    expect(parseWaitingWorkerMarker(null)).toBeNull();
  });
});
