"use client";

// S11 — One row in the "My sessions" list. The whole row is tappable and
// routes to the session detail (S12). Left: a compact date block (short
// weekday + day number, mirroring upcoming-sessions-card.tsx). Middle: the
// product + producer line. Right: the shared StatusPill (confirmed / held /
// done). Date and time are rendered in the Artist's timezone, with Studio time
// added only when the two configured timezones differ.

import { useRouter } from "next/navigation";

import { ClockIcon } from "~/components/artist/funnel/funnel-icons";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { formatSessionTime, type SessionListItem } from "./book-data";
import { StatusPill } from "./status-pill";

function monthShort(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    timeZone,
  });
}

function dayNumber(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    timeZone,
  });
}

export function SessionRow({ session }: { session: SessionListItem }) {
  const router = useRouter();
  const time = formatSessionTime(session.startsAtISO, session.artistTimezone);

  return (
    <button
      type="button"
      onClick={() => {
        router.push(withArtistStudio(`/artist/sessions/${session.id}`, session.producerId));
      }}
      className="sk-press flex w-full items-center gap-3.5 py-3.5 text-left"
    >
      <div className="flex w-12 shrink-0 flex-col items-center">
        <span className="font-amount text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary))] uppercase">
          {monthShort(session.startsAtISO, session.artistTimezone)}
        </span>
        <span className="font-amount text-[20px] leading-none font-bold text-[rgb(var(--fg-default))]">
          {dayNumber(session.startsAtISO, session.artistTimezone)}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-tight font-semibold text-[rgb(var(--fg-default))]">
          {session.packageName}
        </p>
        <p className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-[rgb(var(--fg-muted))]">
          <ClockIcon width={12} height={12} className="shrink-0" />
          <span className="font-amount">{time}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{session.producerName}</span>
        </p>
        {session.heldExpiryReason === "approval_timeout" ? (
          <p className="mt-1 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            The studio did not confirm this request in time.
          </p>
        ) : null}
        {session.changeRequest?.status === "pending" ? (
          <p className="mt-1 text-[11.5px] leading-snug font-medium text-[rgb(var(--brand-primary-dark))]">
            {session.changeRequest.kind === "reschedule"
              ? "Reschedule request awaiting producer"
              : "Cancellation request awaiting producer"}
          </p>
        ) : null}
        {session.billingTreatment === "complimentary" ||
        session.billingTreatment === "billable_extra" ||
        session.artistRsvpStatus ? (
          <p className="mt-1 truncate text-[10.5px] text-[rgb(var(--fg-muted))]">
            {[
              session.billingTreatment === "complimentary" ? "Complimentary" : null,
              session.billingTreatment === "billable_extra" ? "Payment due" : null,
              session.artistRsvpStatus
                ? `Invite: ${artistRsvpShortLabel(session.artistRsvpStatus)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </div>

      <div className="shrink-0">
        <StatusPill status={session.status} outcome={session.outcome} />
      </div>
    </button>
  );
}

function artistRsvpShortLabel(status: NonNullable<SessionListItem["artistRsvpStatus"]>): string {
  if (status === "accepted") return "accepted";
  if (status === "declined") return "declined";
  if (status === "tentative") return "maybe";
  return "awaiting reply";
}
