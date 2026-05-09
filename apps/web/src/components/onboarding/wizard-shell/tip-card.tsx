import { Lightbulb } from "lucide-react";

// Helper card that lives at the bottom of the StepRail. Per the
// redesign README §StepRail, the tip card is a small reassurance
// surface ("Don't overthink it. You can change every single thing
// later — even your link.") that takes up the empty space at the
// bottom of the rail when the step list is shorter than the viewport.
//
// Server component — no behavior, just markup. Body text is passed as
// children so each step can swap in step-specific tips later (Welcome
// uses the default; later steps may show context-relevant copy).

export function TipCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--brand-primary-dark))]">
          <Lightbulb size={12} aria-hidden />
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          Tip
        </span>
      </div>
      <div className="text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
        {children}
      </div>
    </div>
  );
}
