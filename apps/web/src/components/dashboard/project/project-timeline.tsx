// Horizontal 5-step progress rail for the Project Room header.
// Trial → Contract → In Progress → Final → Paid.
//
// All the state logic lives in `computeTimeline` (see
// ./timeline-helpers.ts). This file is just the render — it takes the
// same props shape the helper does and maps each step to a numbered
// circle + label + connecting line. Token-driven styling (zero hex)
// so dark/light swaps cleanly.
//
// Mobile: the rail scrolls horizontally when the viewport can't fit
// all five steps inline. Connecting lines stretch between circles via
// flex-1 so spacing stays even as the container resizes.

import {
  computeTimeline,
  type ProjectTimelineInput,
  type TimelineStepState,
} from "./timeline-helpers";

export function ProjectTimeline(props: ProjectTimelineInput) {
  const steps = computeTimeline(props);
  return (
    // Horizontal scroll on narrow viewports — at 360px, 5 steps
    // shouldn't wrap-cram. The rail stays a single row and the
    // connecting lines keep their proportions as the user swipes.
    <nav aria-label="Project progress" className="-mx-1 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-0 px-1">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li
              key={step.label}
              className={[
                "flex items-center",
                isLast ? "" : "flex-1",
              ].join(" ")}
            >
              <StepCircle state={step.state} index={i} />
              <span
                className={[
                  "ml-2 whitespace-nowrap text-xs sm:text-sm",
                  step.state === "current"
                    ? "font-medium text-[rgb(var(--fg-primary))]"
                    : step.state === "done"
                      ? "text-[rgb(var(--fg-primary))]"
                      : "text-[rgb(var(--fg-muted))]",
                ].join(" ")}
              >
                {step.label}
              </span>
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={[
                    "mx-2 h-px flex-1 min-w-[1.5rem]",
                    // Connector fill mirrors the LEFT step's state —
                    // a "done" step implies the transition to the next
                    // has actually happened, so its trailing connector
                    // is filled. Current/pending keep it muted.
                    step.state === "done"
                      ? "bg-[rgb(var(--brand-primary))]"
                      : "bg-[rgb(var(--border-subtle))]",
                  ].join(" ")}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepCircle({ state, index }: { state: TimelineStepState; index: number }) {
  const base =
    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[0.66rem] sm:h-7 sm:w-7 sm:text-xs";
  if (state === "done") {
    return (
      <span
        aria-label={`Step ${(index + 1).toString()} complete`}
        className={[
          base,
          "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]",
        ].join(" ")}
      >
        {/* A unicode check keeps us inline-SVG-free; the visual weight
            lines up with the numbered circles at both mobile + desktop. */}
        ✓
      </span>
    );
  }
  if (state === "current") {
    return (
      <span
        aria-current="step"
        className={[
          base,
          "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold",
        ].join(" ")}
      >
        {(index + 1).toString()}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={[
        base,
        "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))]",
      ].join(" ")}
    >
      {(index + 1).toString()}
    </span>
  );
}
