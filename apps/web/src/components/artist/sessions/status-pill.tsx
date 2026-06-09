// Small shared status pill for the artist sessions screens (My sessions
// list + session detail). One chip, three tones — confirmed reads as
// settled (green), held reads as pending the producer's confirmation
// (amber), done reads as neutral/past. Colour is driven entirely by the
// app's semantic tokens so it themes with the rest of the artist surface.

import type { SessionStatus } from "./book-data";

const TONE: Record<
  SessionStatus,
  { label: string; bg: string; fg: string; dot: string }
> = {
  confirmed: {
    label: "Confirmed",
    bg: "rgb(var(--fg-success) / 0.12)",
    fg: "rgb(var(--fg-success))",
    dot: "rgb(var(--fg-success))",
  },
  held: {
    label: "Held",
    bg: "rgb(var(--brand-primary) / 0.14)",
    fg: "rgb(var(--brand-primary-dark))",
    dot: "rgb(var(--fg-warning))",
  },
  done: {
    label: "Done",
    bg: "rgb(var(--bg-sunken))",
    fg: "rgb(var(--fg-muted))",
    dot: "rgb(var(--fg-muted))",
  },
};

export function StatusPill({ status }: { status: SessionStatus }) {
  const tone = TONE[status];
  return (
    <span
      className="inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.12em]"
      style={{ background: tone.bg, color: tone.fg }}
    >
      <span
        aria-hidden
        className="h-[6px] w-[6px] shrink-0 rounded-full"
        style={{ background: tone.dot }}
      />
      {tone.label}
    </span>
  );
}
