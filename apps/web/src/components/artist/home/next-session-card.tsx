import Link from "next/link";

import { ProducerArt } from "./producer-art";

export type NextSessionStripProps = {
  nextSession: {
    id: string;
    startsAt: Date;
    durationMin: number;
    producerName: string;
    productName: string | null;
  } | null;
};

export function NextSessionCard({ nextSession }: NextSessionStripProps) {
  if (!nextSession) return <EmptyState />;
  const today = isToday(nextSession.startsAt);
  return (
    <article className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <ProducerArt
        producerName={nextSession.producerName}
        size={36}
        initialsFontSize={11}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <h3
            className="truncate text-[16px] font-bold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.02em" }}
          >
            {nextSession.productName ?? "Session"}
          </h3>
          {today && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.08em]"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "#111009",
                fontFamily: "var(--font-jetbrains-mono)",
              }}
            >TODAY</span>
          )}
        </div>
        <p
          className="mt-0.5 truncate text-[12.5px] text-[var(--fg-muted)]"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          {formatSessionLine(nextSession.startsAt, nextSession.durationMin)}
        </p>
      </div>
      <Link
        href="/artist/book"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--fg-default)] transition-colors hover:bg-[var(--bg-background)]"
      >
        Open calendar →
      </Link>
    </article>
  );
}

function EmptyState() {
  return (
    <article className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <div
        className="size-9 rounded-full border border-dashed border-[var(--border-subtle)] bg-[var(--bg-background)]"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3
          className="truncate text-[16px] font-bold text-[var(--fg-default)]"
          style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.02em" }}
        >
          No session booked.
        </h3>
        <p className="mt-0.5 truncate text-[12.5px] text-[var(--fg-muted)]">
          When you book your next session it shows up here.
        </p>
      </div>
      <Link
        href="/artist/book"
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand-primary)] px-3.5 py-2 text-[12.5px] font-bold text-[#111009] transition-transform hover:brightness-110 active:scale-[0.97]"
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
