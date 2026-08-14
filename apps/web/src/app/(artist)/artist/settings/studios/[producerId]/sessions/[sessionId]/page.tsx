import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import { CalendarDays, Clock3, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  artistSessionDisplay,
  formatSessionDate,
  formatSessionTime,
  formatSessionTimeZoneLabel,
  formatStudioTimeLine,
  locationLabel,
} from "~/components/artist/sessions/book-data";
import { PastStudioRecordShell } from "~/components/artist/settings/past-studio-record-shell";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ producerId: string; sessionId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Past studio session" };

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${String(remaining)} min`;
  if (remaining === 0) return `${String(hours)} hr`;
  return `${String(hours)} hr ${String(remaining)} min`;
}

export default async function ArtistPastStudioSessionPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { producerId, sessionId } = await params;
  if (!UUID.test(producerId) || !UUID.test(sessionId)) notFound();

  let session;
  try {
    session = await appRouter
      .createCaller({ userId })
      .artistPlatform.history.session({ producerId, sessionId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const display = artistSessionDisplay({
    status: session.status,
    outcome: session.outcome,
  });
  const backHref = `/artist/settings/studios/${encodeURIComponent(producerId)}`;
  const startsAtIso = session.startsAt.toISOString();
  const studioTime = formatStudioTimeLine(
    startsAtIso,
    session.artistTimezone,
    session.producerTimezone,
  );

  return (
    <PastStudioRecordShell
      backHref={backHref}
      studioName={session.producerName}
      eyebrow="Session record"
      title={display.label}
      subtitle={`${session.productName} · ${session.projectTitle}`}
    >
      <section className="overflow-hidden rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] p-5 text-white shadow-[var(--shadow-md)]">
        <p className="font-mono text-[9px] font-semibold tracking-[0.14em] text-[rgb(255_255_255_/_0.5)] uppercase">
          {durationLabel(session.durationMin)} session
        </p>
        <h2 className="font-display mt-2 text-[clamp(1.7rem,7vw,2.6rem)] leading-tight font-extrabold tracking-[-0.04em]">
          {formatSessionDate(startsAtIso, session.artistTimezone)} at{" "}
          <span className="font-mono">
            {formatSessionTime(startsAtIso, session.artistTimezone)}
          </span>
        </h2>
        <p className="mt-2 text-[11.5px] text-[rgb(255_255_255_/_0.55)]">
          {formatSessionTimeZoneLabel(startsAtIso, session.artistTimezone)}
        </p>
        {studioTime ? (
          <p className="mt-1 text-[11px] leading-snug text-[rgb(255_255_255_/_0.55)]">
            {studioTime}
          </p>
        ) : null}
        {display.secondary ? (
          <p className="mt-2 text-[11.5px] text-[rgb(255_255_255_/_0.55)]">{display.secondary}</p>
        ) : null}
      </section>

      <section className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          <SessionField
            icon={<CalendarDays size={15} aria-hidden />}
            label="Date"
            value={formatSessionDate(startsAtIso, session.artistTimezone)}
          />
          <SessionField
            icon={<Clock3 size={15} aria-hidden />}
            label="Time"
            value={`${formatSessionTime(startsAtIso, session.artistTimezone)} · ${formatSessionTimeZoneLabel(startsAtIso, session.artistTimezone)}`}
            secondary={studioTime}
          />
          <SessionField
            icon={<MapPin size={15} aria-hidden />}
            label="Location"
            value={locationLabel(session.locationType)}
          />
        </dl>
      </section>
    </PastStudioRecordShell>
  );
}

function SessionField({
  icon,
  label,
  value,
  secondary,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  secondary?: string | null;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 font-mono text-[9px] font-semibold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">{value}</dd>
      {secondary ? (
        <dd className="mt-1 text-[10.5px] leading-snug text-[rgb(var(--fg-muted))]">{secondary}</dd>
      ) : null}
    </div>
  );
}
