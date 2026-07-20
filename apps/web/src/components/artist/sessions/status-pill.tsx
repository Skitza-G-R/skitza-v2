// Small shared status pill for the artist sessions screens (My sessions
// list + session detail). One chip, three tones — confirmed reads as
// settled (green), held reads as pending the producer's confirmation
// (amber), done reads as neutral/past. Colour is driven entirely by the
// app's semantic tokens so it themes with the rest of the artist surface.
//
// `onDark` switches to the proto-s12 dark-hero treatment: a soft tone-tinted
// pill with the label in sentence case (body font), still with the dot —
// instead of the light-surface mono-caps chip.

import type { SessionOutcome, SessionStatus } from "./book-data";

const TONE: Record<
  SessionStatus,
  {
    label: string;
    bg: string;
    fg: string;
    dot: string;
    onDarkBg: string;
    onDarkFg: string;
  }
> = {
  confirmed: {
    label: "Confirmed",
    bg: "rgb(var(--fg-success) / 0.12)",
    fg: "rgb(var(--fg-success))",
    dot: "rgb(var(--fg-success))",
    onDarkBg: "rgb(var(--fg-success) / 0.16)",
    onDarkFg: "rgb(134 211 158)",
  },
  pending_approval: {
    label: "Pending",
    bg: "rgb(var(--brand-primary) / 0.14)",
    fg: "rgb(var(--brand-primary-dark))",
    dot: "rgb(var(--fg-warning))",
    onDarkBg: "rgb(var(--brand-primary) / 0.16)",
    onDarkFg: "rgb(var(--brand-primary))",
  },
  rejected: {
    label: "Declined",
    bg: "rgb(var(--fg-danger) / 0.10)",
    fg: "rgb(var(--fg-danger))",
    dot: "rgb(var(--fg-danger))",
    onDarkBg: "rgb(var(--fg-danger) / 0.16)",
    onDarkFg: "rgb(255 165 165)",
  },
  cancelled: {
    label: "Cancelled",
    bg: "rgb(var(--bg-sunken))",
    fg: "rgb(var(--fg-muted))",
    dot: "rgb(var(--fg-muted))",
    onDarkBg: "rgb(255 255 255 / 0.08)",
    onDarkFg: "rgb(255 255 255 / 0.65)",
  },
  completed: {
    label: "Completed",
    bg: "rgb(var(--bg-sunken))",
    fg: "rgb(var(--fg-muted))",
    dot: "rgb(var(--fg-success))",
    onDarkBg: "rgb(255 255 255 / 0.08)",
    onDarkFg: "rgb(255 255 255 / 0.65)",
  },
  no_show: {
    label: "No-show",
    bg: "rgb(var(--bg-sunken))",
    fg: "rgb(var(--fg-muted))",
    dot: "rgb(var(--fg-muted))",
    onDarkBg: "rgb(255 255 255 / 0.08)",
    onDarkFg: "rgb(255 255 255 / 0.65)",
  },
};

export function StatusPill({
  status,
  outcome = null,
  onDark = false,
}: {
  status: SessionStatus;
  outcome?: SessionOutcome;
  onDark?: boolean;
}) {
  const tone = TONE[status];
  const label =
    status === "cancelled" && outcome === "cancelled_late"
      ? "Cancelled late"
      : status === "cancelled" && outcome === "cancelled_by_producer"
        ? "Producer cancelled"
        : status === "cancelled" && outcome === "cancelled_on_time"
          ? "Cancelled on time"
          : tone.label;
  return (
    <span
      className={
        onDark
          ? "inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] px-[11px] py-[4px] text-[11.5px] font-semibold"
          : "font-amount inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] px-[10px] py-[3px] text-[10px] font-bold tracking-[0.12em] uppercase"
      }
      style={{
        background: onDark ? tone.onDarkBg : tone.bg,
        color: onDark ? tone.onDarkFg : tone.fg,
      }}
    >
      <span
        aria-hidden
        className="h-[6px] w-[6px] shrink-0 rounded-full"
        style={{ background: onDark ? tone.onDarkFg : tone.dot }}
      />
      {label}
    </span>
  );
}
