// Small shared status pill for the artist sessions screens (My sessions
// list + session detail). One chip, three tones — confirmed reads as
// settled (green), held reads as pending the producer's confirmation
// (amber), done reads as neutral/past. Colour is driven entirely by the
// app's semantic tokens so it themes with the rest of the artist surface.
//
// `onDark` switches to the proto-s12 dark-hero treatment: a soft tone-tinted
// pill with the label in sentence case (body font), still with the dot —
// instead of the light-surface mono-caps chip.

import type { SessionStatus } from "./book-data";

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
  held: {
    label: "Held",
    bg: "rgb(var(--brand-primary) / 0.14)",
    fg: "rgb(var(--brand-primary-dark))",
    dot: "rgb(var(--fg-warning))",
    onDarkBg: "rgb(var(--brand-primary) / 0.16)",
    onDarkFg: "rgb(var(--brand-primary))",
  },
  done: {
    label: "Done",
    bg: "rgb(var(--bg-sunken))",
    fg: "rgb(var(--fg-muted))",
    dot: "rgb(var(--fg-muted))",
    onDarkBg: "rgb(255 255 255 / 0.08)",
    onDarkFg: "rgb(255 255 255 / 0.65)",
  },
};

export function StatusPill({
  status,
  onDark = false,
}: {
  status: SessionStatus;
  onDark?: boolean;
}) {
  const tone = TONE[status];
  return (
    <span
      className={
        onDark
          ? "inline-flex items-center gap-[6px] rounded-full px-[11px] py-[4px] text-[11.5px] font-semibold"
          : "inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] font-amount text-[10px] font-bold uppercase tracking-[0.12em]"
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
      {tone.label}
    </span>
  );
}
