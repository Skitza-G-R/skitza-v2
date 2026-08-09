"use client";

import { GoogleCalendarPreview } from "~/app/dev/sk192-google-calendar/google-calendar-preview";
import type { GoogleCalendarUiModel } from "~/app/(producer)/dashboard/calendar/google-calendar-ui-model";
import { SessionsPanel } from "~/app/(producer)/dashboard/calendar/sessions-panel";
import type { SessionListItem } from "~/app/(producer)/dashboard/calendar/session-row";

const MODEL: Extract<GoogleCalendarUiModel, { status: "connected" }> = {
  status: "connected",
  accountLabel: "Northline Studio account",
  syncSummary: { syncing: 1, notSynced: 1, missing: 1, conflicts: 1 },
  calendars: [
    {
      selectionKey: "studio-sessions",
      name: "Studio sessions",
      timeZone: "Asia/Jerusalem",
      accessRole: "owner",
      primary: true,
    },
  ],
  selection: {
    destinationSelectionKey: "studio-sessions",
    busySelectionKeys: ["studio-sessions"],
  },
};

const SESSIONS: readonly SessionListItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    artistName: "Maya Cohen",
    artistEmail: "maya@example.test",
    startsAt: "2026-08-10T07:00:00.000Z",
    durationMin: 90,
    packageName: "Vocal recording",
    status: "confirmed",
    artistRsvpStatus: "accepted",
    calendarSync: { state: "pending" },
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    artistName: "Noam Levi",
    artistEmail: "noam@example.test",
    startsAt: "2026-08-11T12:30:00.000Z",
    durationMin: 60,
    packageName: "Mix review",
    status: "confirmed",
    artistRsvpStatus: "needs_action",
    calendarSync: { state: "not_synced" },
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    artistName: "Lior Ben",
    artistEmail: "lior@example.test",
    startsAt: "2026-08-12T15:00:00.000Z",
    durationMin: 60,
    packageName: "Production session",
    status: "confirmed",
    artistRsvpStatus: "declined",
    calendarSync: { state: "missing" },
  },
  {
    id: "00000000-0000-4000-8000-000000000104",
    artistName: "Dana Tal",
    artistEmail: "dana@example.test",
    startsAt: "2026-08-13T09:00:00.000Z",
    durationMin: 120,
    packageName: "Songwriting",
    status: "confirmed",
    artistRsvpStatus: "tentative",
    calendarSync: { state: "conflict" },
  },
];

export function Sk195GoogleSyncPreview({ dialogOpen }: { dialogOpen: boolean }) {
  return (
    <GoogleCalendarPreview
      state="connected"
      googleControlOpen={dialogOpen}
      modelOverride={MODEL}
      sessionsContent={
        <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay))] p-2 sm:p-3">
          <SessionsPanel
            sessions={SESSIONS}
            initialNow="2026-08-09T09:00:00.000Z"
            timeZone="Asia/Jerusalem"
          />
        </div>
      }
    />
  );
}
