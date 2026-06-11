"use client";

// S11 — Confirmation moment (the quiet beat right after a slot is booked or
// held). Echoes request-sent-screen.tsx's calm celebration, scaled DOWN to
// sit inside the standing "My sessions" shell (no fixed overlay): a single
// rounded-card the page stacks above the sessions list. Two tones:
//
//   confirmed → green RippleEmblem CheckLarge + "YOU'RE BOOKED" + date/time
//   held      → amber RippleEmblem ClockIcon  + "HOLDING YOUR TIME" — the
//               producer hasn't approved the slot yet.
//
// Matches proto-s11: a green-tinted card with a rippling green check, the
// date + time large in Syne (time in font-amount), a one-line subtitle, then
// a greyed "Add to calendar" chip with a "Soon" badge — Google Calendar sync
// is v2 (see the design handoff S11 notes), so it reads as coming-soon, not
// broken.

import { RippleEmblem } from "~/components/artist/funnel/funnel-ui";
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
  const tone = confirmed ? "success" : "amber";
  const accent = confirmed
    ? "rgb(var(--fg-success))"
    : "rgb(var(--brand-primary-dark))";
  const tint = confirmed
    ? "rgb(var(--fg-success) / 0.10)"
    : "rgb(var(--brand-primary) / 0.08)";
  const ring = confirmed
    ? "rgb(var(--fg-success) / 0.25)"
    : "rgb(var(--brand-primary) / 0.22)";

  return (
    <div
      className="sk-rise relative overflow-hidden rounded-card px-5 pb-6 pt-7 text-center"
      style={{
        animationDelay: "40ms",
        /* proto-s11: the whole card is tone-tinted, not just a top glow */
        background: `linear-gradient(0deg, ${tint}, ${tint}), rgb(var(--bg-elevated))`,
        border: `1px solid ${ring}`,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* rippling emblem — green check (confirmed) / amber clock (held) */}
      <RippleEmblem tone={tone} className="mb-4">
        {confirmed ? <CheckLarge /> : <ClockIcon width={30} height={30} />}
      </RippleEmblem>

      <div
        className="font-amount text-[10px] font-bold uppercase tracking-[0.18em]"
        style={{ color: accent }}
      >
        {confirmed ? "You're booked" : "Holding this time"}
      </div>

      {/* date + time — large in Syne, time in font-amount */}
      <h2 className="mt-2 text-balance font-syne text-[26px] font-extrabold leading-[1.06] tracking-[-0.035em] text-[rgb(var(--fg-default))]">
        {date} at <span className="font-amount font-extrabold">{time}</span>
      </h2>

      <p className="mx-auto mt-2 max-w-[280px] text-pretty text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
        {confirmed
          ? `${session.productName} with ${producerName}`
          : `Holding this time while ${producerName} confirms — we'll ping you the moment they approve.`}
      </p>

      {/* greyed coming-soon chip — Google Calendar sync is v2 */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <span
          aria-disabled
          className="inline-flex cursor-not-allowed items-center gap-2 rounded-[var(--radius-lg)] px-4 py-2.5 font-amount text-[11px] font-semibold tracking-[0.04em]"
          style={{
            background: "rgb(var(--fg-default) / 0.05)",
            color: "rgb(var(--fg-muted) / 0.85)",
            border: "1px solid rgb(var(--border-subtle))",
          }}
        >
          Add to calendar
        </span>
        <span
          className="inline-flex items-center rounded-full px-2 py-1 font-amount text-[9px] font-bold uppercase tracking-[0.12em]"
          style={{
            background: "rgb(var(--fg-default) / 0.05)",
            color: "rgb(var(--fg-muted) / 0.85)",
          }}
        >
          Soon
        </span>
      </div>
    </div>
  );
}
