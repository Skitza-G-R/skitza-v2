import { withArtistStudio } from "~/lib/artist-studio-context";

import {
  artistSessionDisplay,
  type SessionOutcome,
  type SessionStatus,
} from "../sessions/book-data";
import type { ArtistHomeAction } from "./home-priority";
import { formatArtistDateTime, formatArtistTimeRange, isSameArtistDay } from "./home-timezone";

type ArtistHomeSession = Readonly<{
  id: string;
  producerId: string;
  packageName: string;
  startsAt: Date;
  durationMin: number;
  status: SessionStatus;
  outcome: SessionOutcome;
  heldExpiryReason: "approval_timeout" | null;
}>;

export function artistHomeBookingStatusActions(input: {
  sessions: readonly ArtistHomeSession[];
  producerId: string;
  artistTimezone: string;
  now: Date;
}): ArtistHomeAction[] {
  return input.sessions
    .filter(
      (session) =>
        session.producerId === input.producerId &&
        session.startsAt.getTime() >= input.now.getTime(),
    )
    .map((session) => ({ session, display: artistSessionDisplay(session) }))
    .filter(({ display }) => display.status === "held" || display.status === "confirmed")
    .sort(
      (left, right) =>
        left.session.startsAt.getTime() - right.session.startsAt.getTime() ||
        left.session.id.localeCompare(right.session.id),
    )
    .map(({ session, display }) => {
      const when = isSameArtistDay(session.startsAt, input.now, input.artistTimezone)
        ? `Today, ${formatArtistTimeRange(
            session.startsAt,
            session.durationMin,
            input.artistTimezone,
          )}`
        : formatArtistDateTime(session.startsAt, input.artistTimezone);
      const detail = [display.label, display.secondary, when].filter(Boolean).join(" · ");

      return {
        id: session.id,
        kind: "session_status" as const,
        title: session.packageName,
        detail,
        href: withArtistStudio(`/artist/sessions/${session.id}`, input.producerId),
        actionLabel: "View session",
        upcomingAt: session.startsAt,
        occurredAt: session.startsAt,
      };
    });
}
