"use client";

// S11 — Active-booking header. A quiet amber-tinted card that shows how many
// sessions of the artist's current package are used. The display ADAPTS to
// the package shape (progressMode in book-data.ts):
//
//   dots  (≤ 6 sessions) → filled vs hollow dots + "{used}/{total}"
//   bar   (> 6 sessions) → a brand-primary fill bar + "{used} of {total}"
//   count (open-ended)   → "{used} sessions booked", no track
//
// Pure presentation: the mode + dot array come from the shared helpers, so
// the server and client agree and the unit tests stay deterministic.

import {
  buildProgressDots,
  progressMode,
  type ActiveBooking,
} from "./book-data";

export function ActiveBookingHeader({ booking }: { booking: ActiveBooking }) {
  const mode = progressMode(booking.sessionsTotal);
  const used = booking.sessionsUsed;
  const total = booking.sessionsTotal;

  return (
    <div
      className="reveal-up rounded-[var(--radius-lg)] px-4 py-3.5"
      style={{
        background: "rgb(var(--brand-primary) / 0.05)",
        border: "1px solid rgb(var(--brand-primary) / 0.18)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--brand-primary-dark))]">
            Active package
          </div>
          <div className="mt-1 truncate font-syne text-[15px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
            {booking.productName}
          </div>
        </div>

        {mode === "dots" && total !== null ? (
          <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[rgb(var(--fg-secondary))]">
            {used}/{total}
          </span>
        ) : null}
        {mode === "bar" && total !== null ? (
          <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[rgb(var(--fg-secondary))]">
            {used} of {total}
          </span>
        ) : null}
        {mode === "count" ? (
          <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-[rgb(var(--fg-secondary))]">
            {used} sessions booked
          </span>
        ) : null}
      </div>

      {/* the track adapts to the package shape */}
      {mode === "dots" && total !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-[7px]">
          {buildProgressDots(used, total).map((dot, i) => (
            <span
              key={i}
              aria-hidden
              className="h-[9px] w-[9px] rounded-full"
              style={{
                background: dot.filled
                  ? "rgb(var(--brand-primary))"
                  : "transparent",
                border: dot.filled
                  ? "1px solid rgb(var(--brand-primary))"
                  : "1px solid rgb(var(--brand-primary) / 0.35)",
              }}
            />
          ))}
        </div>
      ) : null}

      {mode === "bar" && total !== null ? (
        <div
          className="mt-3 h-[7px] w-full overflow-hidden rounded-full"
          style={{ background: "rgb(var(--brand-primary) / 0.14)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${String(Math.min(100, Math.round((used / total) * 100)))}%`,
              background: "rgb(var(--brand-primary))",
            }}
          />
        </div>
      ) : null}
      {/* count mode → no track, the inline label carries it */}
    </div>
  );
}
