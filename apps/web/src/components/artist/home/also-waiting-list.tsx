import Link from "next/link";

// Server component — the quiet list under the focal card. Shows the
// urgent items NOT promoted to the focal slot, plus the next session
// if it isn't already focal. Hairline dividers between rows, no
// per-row cards.
//
// Section architecture (Round 1, 2026-05-23 polish pass):
//   - "01 / INBOX" numbered mono eyebrow
//   - "Also waiting" Syne display subhead
//   - border-t rule line under the header
//   - Rows of either WaitingRow content or a single "empty" synth row
//
// The numbered eyebrow + display subhead + rule give each section a
// clear visual identity even when it holds 0 real items. Avoids the
// "page looks empty / where am I" failure mode the bare 13px label
// produced.

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

export type DisplayRow = WaitingRow | { kind: "empty" };

// Pure helper — owns the "if there's nothing, show the empty row"
// decision so the component is dumb and the behavior is testable in
// node (no jsdom needed).
export function getWaitingRows(rows: WaitingRow[]): DisplayRow[] {
  if (rows.length === 0) return [{ kind: "empty" }];
  return rows;
}

export function AlsoWaitingList({ rows }: { rows: WaitingRow[] }) {
  const displayRows = getWaitingRows(rows);

  return (
    <section
      aria-labelledby="also-waiting-heading"
      className="reveal-up-delay-2"
    >
      <SectionMarker
        number="01"
        eyebrow="Inbox"
        headingId="also-waiting-heading"
      >
        Also waiting
      </SectionMarker>
      <div className="-mx-3 mt-3">
        {displayRows.map((row, idx) => (
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

// ─── Section marker ─────────────────────────────────────────────────

function SectionMarker({
  number,
  eyebrow,
  headingId,
  children,
}: {
  number: string;
  eyebrow: string;
  headingId: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          <span style={{ color: "rgb(var(--brand-primary))" }}>{number}</span>
          <span className="mx-2 text-[rgb(var(--fg-faint))]">/</span>
          {eyebrow}
        </p>
      </div>
      <h2
        id={headingId}
        className="mt-1.5 px-1 font-display text-[20px] font-bold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]"
      >
        {children}
      </h2>
      <div
        aria-hidden
        className="mt-2 h-px"
        style={{ background: "rgb(var(--border-strong))" }}
      />
    </div>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────

function Row({ row }: { row: DisplayRow }) {
  if (row.kind === "empty") {
    return (
      <div className="flex items-center gap-4 rounded-[12px] px-3 py-4">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "rgb(var(--fg-faint))" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-[rgb(var(--fg-default))]">
            Inbox zero
          </p>
          <p className="mt-0.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
            Nothing else waiting on you.
          </p>
        </div>
      </div>
    );
  }

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

function getKey(row: DisplayRow): string {
  if (row.kind === "empty") return "empty";
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
