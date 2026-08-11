import { describe, expect, it } from "vitest";

import type { GoogleCalendarConnectionSnapshot } from "~/server/google-calendar/service";

import { presentGoogleCalendar } from "../google-calendar-presentation";

const needsSelection = {
  status: "needs_selection",
  connectionId: "00000000-0000-4000-8000-000000000001",
  accountEmail: "producer@example.test",
  syncSummary: { syncing: 0, notSynced: 0, missing: 0, conflicts: 0, issues: [] },
  calendars: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Primary studio",
      timezone: null,
      accessRole: "owner",
      isPrimary: true,
      isDestination: false,
      blocksAvailability: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      displayName: "Shared busy",
      timezone: "Europe/London",
      accessRole: "writerWithoutPrivateAccess",
      isPrimary: false,
      isDestination: false,
      blocksAvailability: false,
    },
  ],
} satisfies GoogleCalendarConnectionSnapshot;

describe("Google Calendar producer presentation", () => {
  it("keeps the previous account label available after disconnect", () => {
    expect(presentGoogleCalendar({ status: "not_connected" })).toEqual({
      status: "not_connected",
    });
    expect(
      presentGoogleCalendar({
        ...needsSelection,
        status: "disconnected",
      }),
    ).toEqual({
      status: "disconnected",
      accountLabel: "producer@example.test",
      syncSummary: needsSelection.syncSummary,
    });
  });

  it("suggests the writable primary calendar without exposing provider IDs", () => {
    expect(presentGoogleCalendar(needsSelection)).toEqual({
      status: "selection_required",
      accountLabel: "producer@example.test",
      calendars: [
        {
          selectionKey: "00000000-0000-4000-8000-000000000002",
          name: "Primary studio",
          timeZone: "Timezone unavailable",
          accessRole: "owner",
          primary: true,
        },
        {
          selectionKey: "00000000-0000-4000-8000-000000000003",
          name: "Shared busy",
          timeZone: "Europe/London",
          accessRole: "writer_without_private_access",
          primary: false,
        },
      ],
      syncSummary: needsSelection.syncSummary,
      selection: {
        destinationSelectionKey: "00000000-0000-4000-8000-000000000002",
        busySelectionKeys: ["00000000-0000-4000-8000-000000000002"],
      },
    });
  });

  it("uses only the saved selection for a connected account", () => {
    const model = presentGoogleCalendar({
      ...needsSelection,
      status: "connected",
      calendars: needsSelection.calendars.map((calendar, index) => ({
        ...calendar,
        isDestination: index === 0,
        blocksAvailability: index === 1,
      })),
    });
    expect(model.status).toBe("connected");
    if (model.status !== "connected") throw new Error("expected connected model");
    expect(model.selection).toEqual({
      destinationSelectionKey: "00000000-0000-4000-8000-000000000002",
      busySelectionKeys: ["00000000-0000-4000-8000-000000000003"],
    });
  });

  it("does not invent a selection while reconnect is required", () => {
    expect(
      presentGoogleCalendar({
        status: "reconnect_required",
        connectionId: "00000000-0000-4000-8000-000000000001",
        accountEmail: "producer@example.test",
        calendars: [],
        syncSummary: needsSelection.syncSummary,
      }),
    ).toEqual({
      status: "reconnect_required",
      accountLabel: "producer@example.test",
      syncSummary: needsSelection.syncSummary,
    });
  });

  it("turns issue dates into browser-safe text while keeping the session identity", () => {
    const model = presentGoogleCalendar({
      ...needsSelection,
      status: "connected",
      calendars: needsSelection.calendars.map((calendar, index) => ({
        ...calendar,
        isDestination: index === 0,
        blocksAvailability: true,
      })),
      syncSummary: {
        syncing: 0,
        notSynced: 0,
        missing: 1,
        conflicts: 0,
        issues: [
          {
            bookingId: "00000000-0000-4000-8000-000000000004",
            syncState: "missing",
            bookingStatus: "cancelled",
            artistName: "Lior Tansky",
            startsAt: new Date("2026-08-16T07:00:00.000Z"),
            durationMin: 240,
          },
        ],
      },
    });

    if (model.status !== "connected") throw new Error("expected connected model");
    expect(model.syncSummary.issues).toEqual([
      {
        bookingId: "00000000-0000-4000-8000-000000000004",
        syncState: "missing",
        bookingStatus: "cancelled",
        artistName: "Lior Tansky",
        startsAtIso: "2026-08-16T07:00:00.000Z",
        durationMin: 240,
      },
    ]);
  });
});
