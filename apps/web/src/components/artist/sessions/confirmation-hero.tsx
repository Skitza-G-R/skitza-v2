"use client";

// S11 — Confirmation moment (the quiet beat right after a slot is booked or
// held). Echoes request-sent-screen.tsx's calm celebration, scaled DOWN to
// sit inside the standing "My sessions" shell (no fixed overlay): the same
// ripple emblem + Syne headline, but a single card the page can stack above
// the sessions list. Two tones:
//
//   confirmed → green CheckLarge ripple + "You're booked — {date} at {time}"
//   held      → amber ClockIcon  ripple + "Holding this time while {Producer}
//               confirms" (the producer hasn't approved the slot yet).
//
// The "Add to calendar" chip is intentionally greyed — Google Calendar sync
// is v2 (see the design handoff S11 notes), so it reads as coming-soon, not
// broken.

import {
  CheckLarge,
  ClockIcon,
} from "~/components/artist/funnel/funnel-icons";
import {
  formatSessionDate,
  formatSessionTime,
  type SessionListItem,
} from "./book-data";

export function ConfirmationHero({
  session,
  producerName,
}: {
  session: SessionListItem;
  producerName: string;
}) {
  const confirmed = session.status === "confirmed";
  const date = formatSessionDate(session.startsAtISO);
  const time = formatSessionTime(session.startsAtISO);

  // Tone tokens — green = settled, amber = pending the producer's approval.
  const ring = confirmed
    ? "rgb(var(--fg-success) / 0.28)"
    : "rgb(var(--brand-primary) / 0.28)";
  const emblemColor = confirmed
    ? "rgb(var(--fg-success))"
    : "rgb(var(--brand-primary))";
  const emblemShadow = confirmed
    ? "0 14px 34px -12px rgb(17 16 9 / 0.4), inset 0 0 0 1.5px rgb(var(--fg-success) / 0.35)"
    : "0 14px 34px -12px rgb(17 16 9 / 0.4), inset 0 0 0 1.5px rgb(var(--brand-primary) / 0.35)";

  return (
    <div
      className="reveal-up relative overflow-hidden rounded-[var(--radius-xl)] px-5 py-6 text-center"
      style={{
        background: confirmed
          ? "radial-gradient(120% 80% at 50% -10%, rgb(var(--fg-success) / 0.08), transparent 60%), rgb(var(--bg-elevated))"
          : "radial-gradient(120% 80% at 50% -10%, rgb(var(--brand-primary) / 0.10), transparent 60%), rgb(var(--bg-elevated))",
        border: "1px solid rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* emblem with a single ripple ring */}
      <div className="relative mx-auto mb-4 w-fit">
        <span
          className="absolute -inset-[14px] animate-ping rounded-full"
          style={{ border: `1.5px solid ${ring}` }}
        />
        <span
          className="relative flex h-[66px] w-[66px] items-center justify-center rounded-full"
          style={{
            background: "rgb(var(--bg-sidebar))",
            color: emblemColor,
            boxShadow: emblemShadow,
          }}
        >
          {confirmed ? <CheckLarge /> : <ClockIcon width={26} height={26} />}
        </span>
      </div>

      {confirmed ? (
        <h2 className="reveal-up reveal-up-delay-1 text-balance font-syne text-[22px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[rgb(var(--fg-default))]">
          You&apos;re booked — {date} at {time}
        </h2>
      ) : (
        <h2 className="reveal-up reveal-up-delay-1 text-balance font-syne text-[22px] font-extrabold leading-[1.1] tracking-[-0.03em] text-[rgb(var(--fg-default))]">
          Holding this time while {producerName} confirms
        </h2>
      )}

      <p className="reveal-up reveal-up-delay-2 mx-auto mt-2 max-w-[280px] text-pretty text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        {confirmed
          ? `${date} at ${time} · with ${producerName}`
          : `${date} at ${time} — we'll ping you the moment ${producerName} approves.`}
      </p>

      {/* greyed coming-soon chip — Google Calendar sync is v2 */}
      <div className="reveal-up reveal-up-delay-3 mt-4 flex justify-center">
        <span
          aria-disabled
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-[var(--radius-lg)] px-4 py-2.5 font-mono text-[11px] font-semibold tracking-[0.04em]"
          style={{
            background: "rgb(var(--fg-default) / 0.05)",
            color: "rgb(var(--fg-muted) / 0.8)",
            border: "1px solid rgb(var(--border-subtle))",
          }}
        >
          Add to calendar — coming soon
        </span>
      </div>
    </div>
  );
}
