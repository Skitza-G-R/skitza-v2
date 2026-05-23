import Link from "next/link";

// Server component — the quiet list under the focal card. Shows the
// urgent items NOT promoted to the focal slot, plus the next session
// if it isn't already focal. Hairline dividers between rows, no
// cards.
//
// Each row's primary line leads with the most-unique fact (the
// amount on a payment row, the time on a session row); the secondary
// line carries context. A small colored dot signals attention
// urgency — amber for action-required, faint for informational.

export type WaitingRow =
  | {
      kind: "payment";
      bookingId: string;
      amountFormatted: string;
      packageName: string;
      producerName: string;
    }
  | {
      kind: "session";
      sessionId: string;
      startsAt: Date;
      durationMin: number;
      productName: string | null;
      producerName: string;
    };

export function AlsoWaitingList({ rows }: { rows: WaitingRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="also-waiting-heading"
      className="reveal-up-delay-2"
    >
      <h2
        id="also-waiting-heading"
        className="px-1 text-[13px] font-medium text-[rgb(var(--fg-muted))]"
      >
        Also waiting
      </h2>
      <div className="-mx-3 mt-1">
        {rows.map((row, idx) => (
          <div key={getKey(row)}>
            {idx > 0 ? (
              <div
                aria-hidden
                className="mx-3 h-px"
                style={{ background: "rgb(var(--border-subtle))" }}
              />
            ) : null}
            <Row row={row} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({ row }: { row: WaitingRow }) {
  if (row.kind === "payment") {
    return (
      <Link
        href={`/artist/payment/${row.bookingId}`}
        className="sk-press flex items-center gap-4 rounded-[12px] px-3 py-4 transition-colors hover:bg-[rgb(var(--bg-elevated))]"
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-[rgb(var(--fg-default))]">
            {row.amountFormatted} due
          </p>
          <p className="mt-0.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
            {row.packageName} with {row.producerName}
          </p>
        </div>
        <span className="text-[13px] font-medium text-[rgb(var(--fg-muted))]">
          Pay →
        </span>
      </Link>
    );
  }

  // session
  const dayLabel = formatDayLabel(row.startsAt);
  const time = formatTime(row.startsAt);
  const duration = formatDuration(row.durationMin);

  return (
    <Link
      href="/artist/book"
      className="sk-press flex items-center gap-4 rounded-[12px] px-3 py-4 transition-colors hover:bg-[rgb(var(--bg-elevated))]"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: "rgb(var(--fg-faint))" }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-[rgb(var(--fg-default))]">
          {dayLabel} · {time}
        </p>
        <p className="mt-0.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
          {row.productName ?? "Studio session"} with {row.producerName} ·{" "}
          {duration}
        </p>
      </div>
      <span className="text-[13px] font-medium text-[rgb(var(--fg-muted))]">
        View →
      </span>
    </Link>
  );
}

function getKey(row: WaitingRow): string {
  return row.kind === "payment"
    ? `payment-${row.bookingId}`
    : `session-${row.sessionId}`;
}

// "Friday" if within next 7 days; else "May 29".
function formatDayLabel(d: Date): string {
  const ms = d.getTime() - Date.now();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 0 && days < 7) {
    return d.toLocaleDateString("en-US", { weekday: "long" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${String(m)} min`;
  if (m === 0) return `${String(h)} hours`;
  return `${String(h)}h ${String(m)}m`;
}
