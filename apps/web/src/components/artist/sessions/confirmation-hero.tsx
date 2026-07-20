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
// date + time large in Syne (time in font-amount) and a one-line subtitle.

import { RippleEmblem } from "~/components/artist/funnel/funnel-ui";
import { CheckLarge, ClockIcon } from "~/components/artist/funnel/funnel-icons";
import { formatSessionDate, formatSessionTime, type SessionListItem } from "./book-data";

export function ConfirmationHero({ session }: { session: SessionListItem }) {
  if (session.status !== "confirmed" && session.status !== "pending_approval") return null;
  const confirmed = session.status === "confirmed";
  const date = formatSessionDate(session.startsAtISO, session.producerTimezone);
  const time = formatSessionTime(session.startsAtISO, session.producerTimezone);

  // Tone tokens — green = settled, amber = pending the producer's approval.
  const tone = confirmed ? "success" : "amber";
  const accent = confirmed ? "rgb(var(--fg-success))" : "rgb(var(--brand-primary-dark))";
  const tint = confirmed ? "rgb(var(--fg-success) / 0.10)" : "rgb(var(--brand-primary) / 0.08)";
  const ring = confirmed ? "rgb(var(--fg-success) / 0.25)" : "rgb(var(--brand-primary) / 0.22)";

  return (
    <div
      className="sk-rise rounded-card relative overflow-hidden px-5 pt-7 pb-6 text-center"
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
        className="font-amount text-[10px] font-bold tracking-[0.18em] uppercase"
        style={{ color: accent }}
      >
        {confirmed ? "You're booked" : "Holding this time"}
      </div>

      {/* date + time — large in Syne, time in font-amount */}
      <h2 className="font-syne mt-2 text-[26px] leading-[1.06] font-extrabold tracking-[-0.035em] text-balance text-[rgb(var(--fg-default))]">
        {date} at <span className="font-amount font-extrabold">{time}</span>
      </h2>

      <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-relaxed text-pretty text-[rgb(var(--fg-secondary))]">
        {confirmed
          ? `${session.packageName} with ${session.producerName}`
          : `Holding this time while ${session.producerName} confirms — we'll ping you the moment they approve.`}
      </p>
    </div>
  );
}
