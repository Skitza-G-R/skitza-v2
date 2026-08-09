import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  canUseAsGoogleCalendarDestination,
  googleCalendarAccessRoleLabel,
  isGoogleBusyProtectionReduced,
  type GoogleCalendarAccessRole,
} from "../google-calendar-ui-model";

const controlSource = readFileSync(
  new URL("../google-calendar-control.tsx", import.meta.url),
  "utf8",
);
const modelSource = readFileSync(
  new URL("../google-calendar-ui-model.ts", import.meta.url),
  "utf8",
);
const busyProtectionWarningSource = readFileSync(
  new URL("../google-busy-protection-warning.tsx", import.meta.url),
  "utf8",
);

describe("Google Calendar browser-safe UI contract", () => {
  const syncSummary = { syncing: 0, notSynced: 0, missing: 0, conflicts: 0 } as const;
  it("allows only full writers and owners as event destinations", () => {
    const roles: readonly GoogleCalendarAccessRole[] = [
      "owner",
      "writer",
      "writer_without_private_access",
      "reader",
      "free_busy_reader",
    ];

    expect(roles.map(canUseAsGoogleCalendarDestination)).toEqual([true, true, false, false, false]);
    expect(googleCalendarAccessRoleLabel("writer_without_private_access")).toBe("Writer (limited)");
  });

  it("does not add secret or provider identifiers to the browser UI contract", () => {
    const browserSources = `${controlSource}\n${modelSource}\n${busyProtectionWarningSource}`;
    const forbiddenIdentifiers = [
      "accessToken",
      "refreshToken",
      "webhookSecret",
      "calendarId",
      "providerBody",
      "artistEmail",
    ];

    for (const identifier of forbiddenIdentifiers) {
      expect(browserSources).not.toContain(identifier);
    }
    expect(browserSources).not.toMatch(/console\.(?:log|debug|info|warn|error)\s*\(/);
  });

  it("warns only when a configured or connecting add-on has reduced busy-time protection", () => {
    expect(isGoogleBusyProtectionReduced({ status: "not_connected" })).toBe(false);
    expect(isGoogleBusyProtectionReduced({ status: "connecting" })).toBe(true);
    expect(
      isGoogleBusyProtectionReduced({
        status: "disconnected",
        accountLabel: "Producer account",
        syncSummary,
      }),
    ).toBe(true);
    expect(
      isGoogleBusyProtectionReduced({
        status: "selection_required",
        accountLabel: "Producer account",
        calendars: [],
        syncSummary,
        selection: { destinationSelectionKey: null, busySelectionKeys: [] },
      }),
    ).toBe(true);
  });
});
