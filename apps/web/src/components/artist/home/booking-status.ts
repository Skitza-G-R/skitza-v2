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

export type ArtistHomeBookingStatusAction = ArtistHomeAction &
  Readonly<{ mainEligible: boolean }>;

export function artistHomeBookingStatusActions(input: {
  sessions: readonly ArtistHomeSession[];
  producerId: string;
  artistTimezone: string;
  now: Date;
}): ArtistHomeBookingStatusAction[] {
  return input.sessions
    .map((session) => ({ session, display: artistSessionDisplay(session) }))
    .filter(({ session, display }) => {
      if (session.producerId !== input.producerId) return false;
      const startsAt = session.startsAt.getTime();
      const now = input.now.getTime();
      if (display.status === "held") return startsAt > now;
      if (display.status !== "confirmed") return false;
      return startsAt + session.durationMin * 60_000 > now;
    })
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
        mainEligible:
          session.startsAt.getTime() <= input.now.getTime() ||
          isSameArtistDay(session.startsAt, input.now, input.artistTimezone),
      };
    });
}
