import { Check } from "lucide-react";

import { WIZARD_STEPS } from "~/lib/onboarding/wizard-steps";

// 260px-wide vertical rail (desktop only) showing the 5 numbered
// steps plus a "Tip" card slotted at the bottom. Active row gets a
// white fill + dark filled circle with a light number; completed
// rows get a gold filled circle with a checkmark; future rows are
// flat with an outlined circle and a dark number.
//
// Welcome passes activePosition=1 to pre-highlight Step 1 as the
// "next thing" while the producer is still on the welcome screen.
// Each step page passes its own position. completedCount drives the
// gold-with-check state for any row strictly before the active row.
//
// Server component — no jump handlers wired yet (jump-back becomes
// relevant once Step 2+ exist). When that lands, this component will
// take an `onJump?: (position: number) => void` prop and turn rows
// into <Link> for reachable positions.

export function StepRail({
  activePosition,
  completedCount = 0,
}: {
  /** 1..5 — the rail row that should render in the active state. */
  activePosition: 1 | 2 | 3 | 4 | 5;
  /** How many steps have been completed (drives the green-check state). */
  completedCount?: number;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {WIZARD_STEPS.map((step) => {
        const isActive = step.position === activePosition;
        const isComplete = step.position <= completedCount && !isActive;

        const circleClasses = isActive
          ? "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))]"
          : isComplete
            ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
            : "border border-[rgb(var(--border-subtle))] bg-transparent text-[rgb(var(--fg-default))]";

        const rowClasses = isActive
          ? "bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))]"
          : "border border-transparent";

        return (
          <li
            key={step.id}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${rowClasses}`}
          >
            <span
              aria-hidden
              className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${circleClasses}`}
            >
              {isComplete ? <Check size={14} strokeWidth={3} /> : step.position}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
                {step.label}
              </span>
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.04em] text-[rgb(var(--fg-muted))]">
                {step.meta}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
