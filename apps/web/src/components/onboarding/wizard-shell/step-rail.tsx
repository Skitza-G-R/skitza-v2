import { Check } from "lucide-react";
import Link from "next/link";

import { WIZARD_STEPS } from "~/lib/onboarding/wizard-steps";

export function StepRail({
  activePosition,
  completedCount = 1,
  hoursNotNeeded = false,
  previewMode = false,
}: {
  activePosition: 1 | 2 | 3 | 4 | 5;
  completedCount?: number;
  hoursNotNeeded?: boolean;
  previewMode?: boolean;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {WIZARD_STEPS.map((step) => {
        const isActive = step.position === activePosition;
        const isComplete =
          step.state === "complete" ||
          (step.position <= completedCount && !isActive) ||
          (step.id === "availability" && hoursNotNeeded);
        const meta =
          step.id === "availability" && hoursNotNeeded ? "Not needed for this product" : step.meta;

        const row = (
          <>
            <span
              aria-hidden
              className={`ob-rail-circle flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                isActive
                  ? "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))]"
                  : isComplete
                    ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]"
                    : "border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-muted))]"
              }`}
            >
              {isComplete ? <Check size={14} strokeWidth={3} /> : step.position}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] font-bold text-[rgb(var(--fg-default))]">
                {step.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-[rgb(var(--fg-muted))]">{meta}</span>
            </span>
          </>
        );

        const className = `flex min-h-14 items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2.5 transition-colors ${
          isActive
            ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[0_10px_30px_rgb(var(--bg-sidebar)/0.06)]"
            : "border-transparent"
        }`;

        return (
          <li key={step.id}>
            {step.route && (isComplete || isActive) ? (
              <Link
                href={`${step.route}${previewMode ? "?__preview=1" : ""}`}
                aria-current={isActive ? "step" : undefined}
                className={`${className} focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none`}
              >
                {row}
              </Link>
            ) : (
              <div aria-current={isActive ? "step" : undefined} className={className}>
                {row}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
