import Link from "next/link";

import { withArtistStudio } from "~/lib/artist-studio-context";

import { ProducerArt } from "./producer-art";

export type NextSessionStripProps = {
  nextSession: {
    id: string;
    startsAt: Date;
    durationMin: number;
    producerId: string;
    producerName: string;
    productName: string | null;
  } | null;
  activeStudioId: string | null;
};

export function NextSessionCard({ nextSession, activeStudioId }: NextSessionStripProps) {
  if (!nextSession) return <EmptyState activeStudioId={activeStudioId} />;
  const today = isToday(nextSession.startsAt);
  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <ProducerArt
          producerName={nextSession.producerName}
          size={36}
          initialsFontSize={11}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <h3
              className="truncate text-[16px] font-bold text-[rgb(var(--fg-default))]"
              style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.02em" }}
            >
              {nextSession.productName ?? "Session"}
            </h3>
            {today && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.08em]"
                style={{
                  backgroundColor: "rgb(var(--brand-primary))",
                  color: "#111009",
                  fontFamily: "var(--font-jetbrains-mono)",
                }}
              >TODAY</span>
            )}
          </div>
          <p
            className="mt-0.5 truncate text-[12.5px] text-[rgb(var(--fg-muted))]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            {formatSessionLine(nextSession.startsAt, nextSession.durationMin)}
          </p>
        </div>
      </div>
      <Link
        href={withArtistStudio("/artist/book", nextSession.producerId)}
        className="inline-flex shrink-0 items-center gap-1 self-end rounded-full border border-[rgb(var(--border-subtle))] px-3.5 py-2 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-background))] sm:self-auto"
      >
        Open calendar →
      </Link>
    </article>
  );
}

function EmptyState({ activeStudioId }: { activeStudioId: string | null }) {
  return (
    <article className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <div
          className="size-9 shrink-0 rounded-full border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))]"
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3
            className="truncate text-[16px] font-bold text-[rgb(var(--fg-default))]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.02em" }}
          >
            No session booked.
          </h3>
          <p className="mt-0.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
            When you book your next session it shows up here.
          </p>
        </div>
      </div>
      <Link
        href={withArtistStudio("/artist/book", activeStudioId)}
        className="inline-flex shrink-0 items-center gap-1 self-end rounded-full bg-[rgb(var(--brand-primary))] px-3.5 py-2 text-[12.5px] font-bold text-[#111009] transition-transform hover:brightness-110 active:scale-[0.97] sm:self-auto"
      >
        Book a session →
      </Link>
    </article>
  );
}

export function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatSessionLine(startsAt: Date, durationMin: number): string {
  const weekday = startsAt.toLocaleDateString("en-US", { weekday: "short" });
  const hh = String(startsAt.getHours()).padStart(2, "0");
  const mm = String(startsAt.getMinutes()).padStart(2, "0");
  const end = new Date(startsAt.getTime() + durationMin * 60_000);
  const endHh = String(end.getHours()).padStart(2, "0");
  const endMm = String(end.getMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}–${endHh}:${endMm} · ${String(durationMin)}m`;
}
