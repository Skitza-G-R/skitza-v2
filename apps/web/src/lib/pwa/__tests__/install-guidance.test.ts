import { describe, expect, it } from "vitest";

import {
  INSTALL_DISMISS_MS,
  installGuidanceEligible,
  isIphoneLike,
  parseInstallActionMarker,
} from "../install-guidance";

const NOW = Date.UTC(2026, 6, 24);
const ACTION = {
  completedAt: NOW - 60_000,
  sessionId: "previous-session",
} as const;

describe("SK-112 install guidance eligibility", () => {
  it("requires a signed-in meaningful action from an earlier visit", () => {
    expect(
      installGuidanceEligible({
        signedIn: true,
        installed: false,
        standalone: false,
        currentSessionId: "current-session",
        action: ACTION,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      installGuidanceEligible({
        signedIn: true,
        installed: false,
        standalone: false,
        currentSessionId: ACTION.sessionId,
        action: ACTION,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      installGuidanceEligible({
        signedIn: false,
        installed: false,
        standalone: false,
        currentSessionId: "current-session",
        action: ACTION,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      installGuidanceEligible({
        signedIn: true,
        installed: false,
        standalone: false,
        currentSessionId: "current-session",
        action: null,
        dismissedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("suppresses installed/standalone profiles and a dismissal for 90 days", () => {
    for (const state of [
      { installed: true, standalone: false, dismissedAt: null },
      { installed: false, standalone: true, dismissedAt: null },
      {
        installed: false,
        standalone: false,
        dismissedAt: NOW - INSTALL_DISMISS_MS + 1,
      },
    ]) {
      expect(
        installGuidanceEligible({
          signedIn: true,
          currentSessionId: "current-session",
          action: ACTION,
          now: NOW,
          ...state,
        }),
      ).toBe(false);
    }
    expect(
      installGuidanceEligible({
        signedIn: true,
        installed: false,
        standalone: false,
        currentSessionId: "current-session",
        action: ACTION,
        dismissedAt: NOW - INSTALL_DISMISS_MS,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("parses only bounded, valid local markers and recognizes iPhone guidance", () => {
    expect(parseInstallActionMarker(JSON.stringify(ACTION))).toEqual(ACTION);
    expect(parseInstallActionMarker('{"completedAt":"today","sessionId":"x"}')).toBeNull();
    expect(parseInstallActionMarker("not-json")).toBeNull();
    expect(isIphoneLike("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(true);
    expect(isIphoneLike("Mozilla/5.0 (Linux; Android 15)")).toBe(false);
  });
});
