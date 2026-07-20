"use client";

// S11 — "My sessions" (a STANDING app screen, not a funnel overlay). It lives
// inside the artist shell's max-w-2xl <main>, so the bottom tab bar stays
// visible — there's no FunnelTopBar, no fixed inset-0, no back arrow. Top to
// bottom:
//
//   1. eyebrow row "My sessions." (Syne + an amber dot, like BookEyebrow)
//   2. ConfirmationHero — the just-booked beat (driven by ?just=<id> or the
//      most-recent held/confirmed session)
//   3. ActiveBookingHeader — one per purchase-owned allowance
//   4. "Book another session" → the exact open allowance
//   5. the sessions list (divided rows, each tappable → S12)
//   6. SessionsEmpty when there are none
//
import { useRouter, useSearchParams } from "next/navigation";

import { PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import {
  allowanceBookHref,
  allowanceCanBook,
  type AllowanceSummary,
  type SessionListItem,
} from "./book-data";
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
    if (match && (match.status === "pending_approval" || match.status === "confirmed")) {
      return match;
    }
    return null;
  }
  const upcoming = sessions.filter(
    (s) => s.status === "pending_approval" || s.status === "confirmed",
  );
  return upcoming.length > 0 ? (upcoming[0] ?? null) : null;
}

export function MySessionsScreen({
  sessions,
  allowances,
}: {
  sessions: SessionListItem[];
  allowances: AllowanceSummary[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justId = searchParams.get("just");
  const justBooked = pickJustBooked(sessions, justId);
  const hasBookableAllowance = allowances.some(allowanceCanBook);

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
      {justBooked ? <ConfirmationHero session={justBooked} /> : null}

      {/* (3) / (4) purchase-owned allowance progress + exact booking link */}
      {allowances.length > 0 ? (
        <div className="space-y-3">
          {allowances.map((allowance, index) => (
            <section
              key={allowance.sessionAllowanceId}
              className="space-y-2.5"
              aria-label={`${allowance.packageName} session allowance`}
            >
              <ActiveBookingHeader booking={allowance} />
              {allowanceCanBook(allowance) ? (
                <div
                  className="sk-rise"
                  style={{ animationDelay: `${String(120 + index * 30)}ms` }}
                >
                  <PrimaryCta
                    glow={false}
                    sub={bookAnotherSub(allowance)}
                    onClick={() => {
                      router.push(allowanceBookHref(allowance));
                    }}
                  >
                    Book another session
                  </PrimaryCta>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}

      {/* (5) / (6) list or empty */}
      {sessions.length === 0 ? (
        allowances.length === 0 ? (
          <SessionsEmpty />
        ) : (
          <div
            className="sk-rise rounded-card border border-dashed px-4 py-5 text-center"
            style={{
              borderColor: "rgb(var(--border-strong))",
              background: "rgb(var(--bg-elevated))",
            }}
          >
            <p className="font-syne text-[15px] font-extrabold text-[rgb(var(--fg-default))]">
              No sessions booked yet
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              {hasBookableAllowance
                ? "Your purchased session allowance is ready whenever booking is available."
                : "No new booking is available for these allowances. Check each status above for what comes next."}
            </p>
          </div>
        )
      ) : (
        <div className="space-y-2.5">
          <div
            className="sk-rise font-amount inline-flex items-center gap-[9px] text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase"
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
function bookAnotherSub(booking: AllowanceSummary): string {
  if (booking.kind === "unlimited") return "Unlimited sessions on this purchase";
  const left = Math.max(0, booking.sessionsRemaining ?? 0);
  const plural = left === 1 ? "session" : "sessions";
  return `${String(left)} ${plural} left on this booking`;
}
