"use client";

import { useState } from "react";

import { ChangeRequestDecision } from "~/app/(producer)/dashboard/calendar/change-request-decision";
import { SessionManagementSheet } from "~/app/(producer)/dashboard/calendar/session-management-sheet";
import type { SessionListItem } from "~/app/(producer)/dashboard/calendar/session-row";

// Fixed instants so every render of this gallery is identical. The sheet
// compares against the real clock, so "ended" has to be genuinely in the past.
const ENDED_START = "2026-08-20T09:00:00.000Z";
const REQUESTED_AT = "2026-08-26T09:00:00.000Z";
const FUTURE_START = "2026-09-10T15:00:00.000Z";
const PROPOSED_START = "2026-09-12T11:00:00.000Z";

const endedSession: SessionListItem = {
  id: "00000000-0000-4000-8000-0000000002a0",
  artistName: "Dana Levi",
  artistEmail: "dana@example.com",
  startsAt: ENDED_START,
  durationMin: 120,
  title: "Vocal tracking — Session 3",
  packageName: "Midnight EP",
  status: "confirmed",
  billingTreatment: "included",
  artistRsvpStatus: "accepted",
  calendarSync: null,
  changeRequest: null,
};

const rescheduleRequestSession: SessionListItem = {
  ...endedSession,
  id: "00000000-0000-4000-8000-0000000002a1",
  startsAt: FUTURE_START,
  changeRequest: {
    id: "00000000-0000-4000-8000-0000000002b1",
    kind: "reschedule",
    proposedStartsAt: PROPOSED_START,
    requestedAt: REQUESTED_AT,
  },
};

const cancelRequestSession: SessionListItem = {
  ...endedSession,
  id: "00000000-0000-4000-8000-0000000002a2",
  artistName: "Omer Katz",
  startsAt: FUTURE_START,
  changeRequest: {
    id: "00000000-0000-4000-8000-0000000002b2",
    kind: "cancel",
    proposedStartsAt: null,
    requestedAt: REQUESTED_AT,
  },
};

export function Sk280Preview() {
  const [sheetOpen, setSheetOpen] = useState(true);

  // The root layout already mounts the single app-wide ToastProvider.
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10">
      <header className="mb-8">
        <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-[rgb(var(--brand-primary-text))] uppercase">
          SK-280 · visual check
        </p>
        <h1 className="font-display mt-2 text-3xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
          Booking &amp; calendar fixes
        </h1>
        <p className="mt-2 max-w-[62ch] text-sm text-[rgb(var(--fg-muted))]">
          Each panel below is a real component in the state this wave repaired.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
          1 · Ended session — close-out actions
        </h2>
        <p className="mt-1 mb-4 max-w-[62ch] text-sm text-[rgb(var(--fg-muted))]">
          Before: an ended session said “view-only” and offered nothing, so it stayed
          <em> confirmed</em> in the database forever. Now: Mark completed, Mark no-show, and
          “Artist cancelled late — record it”.
        </p>
        <button
          type="button"
          onClick={() => {
            setSheetOpen(true);
          }}
          className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] px-4 text-sm font-semibold"
        >
          Reopen the session sheet
        </button>
        <SessionManagementSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          session={endedSession}
          initialStep="summary"
          timeZone="Asia/Jerusalem"
        />
      </section>

      <section className="mb-10 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
            2 · Artist asked to move a session
          </h2>
          <p className="mt-1 mb-4 max-w-[46ch] text-sm text-[rgb(var(--fg-muted))]">
            Approve now asks for an explicit “Approve anyway” when Google cannot be checked, instead
            of silently skipping the busy check.
          </p>
          <ChangeRequestDecision session={rescheduleRequestSession} timeZone="Asia/Jerusalem" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
            3 · Artist asked to cancel
          </h2>
          <p className="mt-1 mb-4 max-w-[46ch] text-sm text-[rgb(var(--fg-muted))]">
            Both decisions keep working even after the hold window lapses — previously every button
            here errored forever once the expiry cron missed it.
          </p>
          <ChangeRequestDecision session={cancelRequestSession} timeZone="Asia/Jerusalem" />
        </div>
      </section>
    </div>
  );
}
