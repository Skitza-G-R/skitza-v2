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
  allowanceUnavailableMessage,
  buildProgressDots,
  locationLabel,
  progressMode,
  type AllowanceSummary,
} from "./book-data";

export function ActiveBookingHeader({ booking }: { booking: AllowanceSummary }) {
  const mode = progressMode(booking.sessionLimit);
  const used = booking.sessionsUsed;
  const total = booking.sessionLimit;
  const unavailableMessage = allowanceUnavailableMessage(booking);

  return (
    <div
      className="sk-rise rounded-card px-4 py-3.5"
      style={{
        animationDelay: "100ms",
        background: "rgb(var(--brand-primary) / 0.05)",
        border: "1px solid rgb(var(--brand-primary) / 0.18)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="font-amount text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
            {booking.closedAtISO ? "Closed allowance" : "Session allowance"}
          </div>
          <div className="font-syne mt-1 line-clamp-2 text-[16px] leading-snug font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
            {booking.packageName}
          </div>
        </div>

        {mode === "dots" && total !== null ? (
          <span className="font-amount shrink-0 text-[12px] font-semibold text-[rgb(var(--fg-secondary))]">
            {used} of {total} used
          </span>
        ) : null}
        {mode === "bar" && total !== null ? (
          <span className="font-amount shrink-0 text-[12px] font-semibold text-[rgb(var(--fg-secondary))]">
            {used} of {total}
          </span>
        ) : null}
        {mode === "count" ? (
          <span className="font-amount shrink-0 text-[12px] font-semibold text-[rgb(var(--fg-secondary))]">
            {used} sessions used
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
        {booking.projectTitle} · {booking.producerName} · {booking.durationMin} min ·{" "}
        {locationLabel(booking.locationType)}
      </p>
      {unavailableMessage ? (
        <p className="mt-2 text-[11.5px] font-medium leading-relaxed text-[rgb(var(--fg-secondary))]">
          {unavailableMessage}
        </p>
      ) : null}

      {/* the track adapts to the package shape */}
      {mode === "dots" && total !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-[7px]">
          {buildProgressDots(used, total).map((dot, i) => (
            <span
              key={i}
              aria-hidden
              className="h-[9px] w-[9px] rounded-full"
              style={{
                background: dot.filled ? "rgb(var(--brand-primary))" : "transparent",
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
