"use client";

// S11 — "My sessions" (a STANDING app screen, not a funnel overlay). It lives
// inside the artist shell's max-w-2xl <main>, so the bottom tab bar stays
// visible — there's no FunnelTopBar, no fixed inset-0, no back arrow. Top to
// bottom:
//
//   1. eyebrow row "My sessions." (Syne + an amber dot, like BookEyebrow)
//   2. ConfirmationHero — the just-booked beat (driven by ?just=<id> or the
//      most-recent held/confirmed session)
//   3. ActiveBookingHeader — sessions used of the current package
//   4. "Book another session" → /artist/book (only when canBookAnother)
//   5. the sessions list (divided rows, each tappable → S12)
//   6. SessionsEmpty when there are none
//
// Mock data arrives from the route page (book-data MOCK_*); BE-3 (SK-39) will
// swap the page's source for the tRPC caller with the same prop shape.

import { useRouter, useSearchParams } from "next/navigation";

import { PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import type { ActiveBooking, SessionListItem } from "./book-data";
import { ActiveBookingHeader } from "./active-booking-header";
import { ConfirmationHero } from "./confirmation-hero";
import { SessionRow } from "./session-row";
import { SessionsEmpty } from "./sessions-empty";

// Pick the session the confirmation hero should celebrate: an explicit
// ?just=<id> wins (the slot the artist just booked), otherwise fall back to
// the most-recent held-or-confirmed session in the list. `null` → no hero.
function pickJustBooked(
  sessions: SessionListItem[],
  justId: string | null,
): SessionListItem | null {
  if (justId) {
    const match = sessions.find((s) => s.id === justId);
    if (match) return match;
  }
  const upcoming = sessions.filter(
    (s) => s.status === "held" || s.status === "confirmed",
  );
  return upcoming.length > 0 ? (upcoming[0] ?? null) : null;
}

export function MySessionsScreen({
  sessions,
  activeBooking,
  producerName,
}: {
  sessions: SessionListItem[];
  activeBooking: ActiveBooking;
  producerName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justId = searchParams.get("just");
  const justBooked = pickJustBooked(sessions, justId);
  const sessionsLeft = bookAnotherSub(activeBooking);

  return (
    <div className="space-y-4">
      {/* (1) eyebrow row */}
      <div className="sk-rise inline-flex items-center gap-[9px]">
        <span
          aria-hidden
          className="h-[6px] w-[6px] rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
        <span className="font-syne text-[13px] font-extrabold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
          My sessions.
        </span>
      </div>

      {/* (2) confirmation moment */}
      {justBooked ? (
        <ConfirmationHero session={justBooked} producerName={producerName} />
      ) : null}

      {/* (3) active package progress */}
      <ActiveBookingHeader booking={activeBooking} />

      {/* (4) book another (guarded) — amber primary, like the prototype */}
      {activeBooking.canBookAnother ? (
        <div className="sk-rise" style={{ animationDelay: "120ms" }}>
          <PrimaryCta
            glow={false}
            sub={sessionsLeft}
            onClick={() => {
              router.push("/artist/book");
            }}
          >
            Book another session
          </PrimaryCta>
        </div>
      ) : null}

      {/* (5) / (6) list or empty */}
      {sessions.length === 0 ? (
        <SessionsEmpty />
      ) : (
        <div className="space-y-2.5">
          <div
            className="sk-rise inline-flex items-center gap-[9px] font-amount text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
            style={{ animationDelay: "140ms" }}
          >
            <span
              aria-hidden
              className="h-[5px] w-[5px] rounded-full"
              style={{ background: "rgb(var(--brand-primary))" }}
            />
            My sessions
          </div>
          <div
            className="sk-rise rounded-card px-4"
            style={{
              animationDelay: "160ms",
              background: "rgb(var(--bg-elevated))",
              border: "1px solid rgb(var(--border-subtle))",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <ul className="divide-y divide-[rgb(var(--border-subtle))]">
              {sessions.map((session) => (
                <li key={session.id}>
                  <SessionRow session={session} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// Small helper line under "Book another session" — mirrors the prototype's
// "2 sessions left on this booking". Falls back to a generic nudge when the
// package is open-ended (no total).
function bookAnotherSub(booking: ActiveBooking): string {
  if (booking.sessionsTotal === null) return "Set up your next session";
  const left = Math.max(0, booking.sessionsTotal - booking.sessionsUsed);
  const plural = left === 1 ? "session" : "sessions";
  return `${String(left)} ${plural} left on this booking`;
}
