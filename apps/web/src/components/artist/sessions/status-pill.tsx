// Small shared status pill for the artist sessions screens (My sessions
// list + session detail). One chip, three tones — confirmed reads as
// settled (green), held reads as pending the producer's confirmation
// (amber), done reads as neutral/past. Colour is driven entirely by the
// app's semantic tokens so it themes with the rest of the artist surface.
//
// `onDark` brightens the fill so the pill stays legible on the S12 dark
// hero (near-black --bg-sidebar) instead of the light surfaces.

import type { SessionStatus } from "./book-data";

const TONE: Record<
  SessionStatus,
  { label: string; bg: string; fg: string; dot: string; onDarkFg: string }
> = {
  confirmed: {
    label: "Confirmed",
    bg: "rgb(var(--fg-success) / 0.12)",
    fg: "rgb(var(--fg-success))",
    dot: "rgb(var(--fg-success))",
    onDarkFg: "rgb(120 200 140)",
  },
  held: {
    label: "Held",
    bg: "rgb(var(--brand-primary) / 0.14)",
    fg: "rgb(var(--brand-primary-dark))",
    dot: "rgb(var(--fg-warning))",
    onDarkFg: "rgb(var(--brand-primary))",
  },
  done: {
    label: "Done",
    bg: "rgb(var(--bg-sunken))",
    fg: "rgb(var(--fg-muted))",
    dot: "rgb(var(--fg-muted))",
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
      className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] font-amount text-[10px] font-bold uppercase tracking-[0.12em]"
      style={{
        background: onDark ? "rgb(255 255 255 / 0.08)" : tone.bg,
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
