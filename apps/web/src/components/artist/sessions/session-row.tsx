"use client";

// S11 — One row in the "My sessions" list. The whole row is tappable and
// routes to the session detail (S12). Left: a compact date block (short
// weekday + day number, mirroring upcoming-sessions-card.tsx). Middle: the
// product + producer line. Right: the shared StatusPill (confirmed / held /
// done). UTC-safe date math via book-data so SSR and CSR agree.

import { useRouter } from "next/navigation";

import { ClockIcon } from "~/components/artist/funnel/funnel-icons";
import {
  formatSessionTime,
  type SessionListItem,
} from "./book-data";
import { StatusPill } from "./status-pill";

function monthShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function dayNumber(iso: string): number {
  return new Date(iso).getUTCDate();
}

export function SessionRow({ session }: { session: SessionListItem }) {
  const router = useRouter();
  const time = formatSessionTime(session.startsAtISO);

  return (
    <button
      type="button"
      onClick={() => {
        router.push(`/artist/sessions/${session.id}`);
      }}
      className="sk-press flex w-full items-center gap-3.5 py-3.5 text-left"
    >
      <div className="flex w-12 shrink-0 flex-col items-center">
        <span className="font-amount text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]">
          {monthShort(session.startsAtISO)}
        </span>
        <span className="font-amount text-[20px] font-bold leading-none text-[rgb(var(--fg-default))]">
          {dayNumber(session.startsAtISO)}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-tight text-[rgb(var(--fg-default))]">
          {session.productName}
        </p>
        <p className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-[rgb(var(--fg-muted))]">
          <ClockIcon width={12} height={12} className="shrink-0" />
          <span className="font-amount">{time}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{session.producerName}</span>
        </p>
      </div>

      <div className="shrink-0">
        <StatusPill status={session.status} />
      </div>
    </button>
  );
}
