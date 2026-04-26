// Project Dashboard — "What's next" module (Story 04, PRD §11.5).
//
// One-liner that surfaces the single highest-priority next action
// for this project. The procedure already runs the precedence ladder
// (see project-room.ts dashboard query, step 3) and returns the
// winning signal (or null). We just map it to display copy via the
// `buildWhatsNextLine` helper.
//
// When `signal === null` the entire module hides — the silence reads
// as "nothing pressing" which is the right affordance for an empty
// state. Don't show "All caught up!" — that's noise.

import { buildWhatsNextLine, type WhatsNextSignal } from "./dashboard-helpers";

export interface WhatsNextProps {
  signal: WhatsNextSignal | null;
}

export function WhatsNext({ signal }: WhatsNextProps) {
  const line = buildWhatsNextLine(signal);
  if (!line) return null;

  // Intent → tint colour. Mirrors the Badge variant palette: warning
  // for "send contract", danger for unpaid, primary for the rest.
  const tone =
    line.intent === "danger"
      ? "border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.08)]"
      : line.intent === "warning"
        ? "border-[rgb(var(--fg-warning)/0.35)] bg-[rgb(var(--fg-warning)/0.08)]"
        : "border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)]";

  const dotColor =
    line.intent === "danger"
      ? "bg-[rgb(var(--fg-danger))]"
      : line.intent === "warning"
        ? "bg-[rgb(var(--fg-warning))]"
        : "bg-[rgb(var(--brand-primary))]";

  return (
    <section
      aria-label="What's next"
      className={[
        "flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3",
        tone,
      ].join(" ")}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Next
      </p>
      <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
        {line.label}
      </p>
    </section>
  );
}
