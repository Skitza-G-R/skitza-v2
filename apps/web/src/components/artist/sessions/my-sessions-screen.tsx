"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { withArtistStudio } from "~/lib/artist-studio-context";
import {
  allowanceBookHref,
  allowanceCanBook,
  type AllowanceSummary,
  type SessionListItem,
} from "./book-data";
import { ConfirmationHero } from "./confirmation-hero";
import { SessionRow } from "./session-row";

export function groupArtistSessions(sessions: SessionListItem[], nowISO: string) {
  const now = new Date(nowISO).getTime();
  const active = sessions
    .filter((session) => {
      const end = new Date(session.startsAtISO).getTime() + session.durationMin * 60 * 1000;
      return (
        end > now &&
        (session.status === "pending_approval" || session.status === "confirmed")
      );
    })
    .sort(
      (left, right) =>
        new Date(left.startsAtISO).getTime() - new Date(right.startsAtISO).getTime(),
    );
  const confirmed = active.filter((session) => session.status === "confirmed");
  const next = confirmed[0] ?? null;
  const held = active.filter((session) => session.status === "pending_approval");
  const upcoming = confirmed.slice(1);
  const activeIds = new Set(active.map((session) => session.id));
  const past = sessions
    .filter((session) => !activeIds.has(session.id))
    .sort(
      (left, right) =>
        new Date(right.startsAtISO).getTime() - new Date(left.startsAtISO).getTime(),
    );
  return { next, held, upcoming, past };
}

export function MySessionsScreen({
  sessions,
  allowances,
  nowISO,
}: {
  sessions: SessionListItem[];
  allowances: AllowanceSummary[];
  nowISO: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groups = groupArtistSessions(sessions, nowISO);
  const justId = searchParams.get("just");
  const justBooked = justId
    ? (sessions.find(
        (session) =>
          session.id === justId &&
          (session.status === "pending_approval" || session.status === "confirmed"),
      ) ?? null)
    : null;
  const bookableAllowance = allowances.find(allowanceCanBook) ?? null;
  const studioId =
    bookableAllowance?.producerId ??
    allowances[0]?.producerId ??
    sessions[0]?.producerId ??
    searchParams.get("studio");

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
            Studio time
          </p>
          <h1 className="font-display mt-1 text-[30px] leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            Sessions
          </h1>
        </div>
      </header>

      <PrimaryCta
        glow={false}
        onClick={() => {
          router.push(
            bookableAllowance
              ? allowanceBookHref(bookableAllowance)
              : withArtistStudio("/artist/store", studioId),
          );
        }}
        sub={
          bookableAllowance
            ? bookableAllowance.kind === "unlimited"
              ? "Included in your active package"
              : `${String(bookableAllowance.sessionsRemaining ?? 0)} session${bookableAllowance.sessionsRemaining === 1 ? "" : "s"} available`
            : "Choose a service before booking"
        }
      >
        {bookableAllowance ? "Book a session" : "View services"}
      </PrimaryCta>

      {justBooked ? <ConfirmationHero session={justBooked} /> : null}

      {sessions.length === 0 ? (
        <section
          className="rounded-[var(--radius-xl)] border border-dashed px-6 py-10 text-center"
          style={{
            background: "rgb(var(--bg-elevated))",
            borderColor: "rgb(var(--border-strong))",
          }}
        >
          <h2 className="font-display text-[19px] font-extrabold text-[rgb(var(--fg-default))]">
            No sessions yet
          </h2>
          <p className="mx-auto mt-2 max-w-[300px] text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
            Your booked and requested studio times will appear here.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {groups.next ? <SessionGroup title="Next" sessions={[groups.next]} featured /> : null}
          {groups.held.length > 0 ? (
            <SessionGroup title="Held requests" sessions={groups.held} />
          ) : null}
          {groups.upcoming.length > 0 ? (
            <SessionGroup title="Upcoming" sessions={groups.upcoming} />
          ) : null}
          {groups.past.length > 0 ? <SessionGroup title="Past" sessions={groups.past} /> : null}
        </div>
      )}
    </div>
  );
}

function SessionGroup({
  title,
  sessions,
  featured = false,
}: {
  title: string;
  sessions: SessionListItem[];
  featured?: boolean;
}) {
  return (
    <section aria-labelledby={`sessions-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <h2
        id={`sessions-${title.toLowerCase().replaceAll(" ", "-")}`}
        className="mb-2.5 font-mono text-[10px] font-bold tracking-[0.15em] text-[rgb(var(--fg-muted))] uppercase"
      >
        {title}
      </h2>
      <div
        className="rounded-[var(--radius-xl)] border px-4"
        style={{
          background: featured
            ? "linear-gradient(135deg, rgb(var(--brand-primary) / 0.10), rgb(var(--bg-elevated)) 48%)"
            : "rgb(var(--bg-elevated))",
          borderColor: featured
            ? "rgb(var(--brand-primary) / 0.35)"
            : "rgb(var(--border-subtle))",
          boxShadow: featured ? "var(--shadow-md)" : "var(--shadow-sm)",
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
    </section>
  );
}
