// step-bar.tsx
//
// Discrete-dash progress indicator for the editor wizard. Each step is a
// fixed-width pill (~32px × 3px); brand-amber fills past + current steps,
// the rest are muted. Pure presentation. Mirrors the reference design
// (storefront.html prototype) which uses small dashes rather than a
// continuous segmented bar.

interface StepBarProps {
  steps: readonly string[];
  current: string;
}

export function StepBar({ steps, current }: StepBarProps) {
  const currentIdx = Math.max(0, steps.indexOf(current));
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={currentIdx + 1}
      className="flex items-center gap-1.5"
    >
      {steps.map((id, idx) => {
        const reached = idx <= currentIdx;
        return (
          <span
            key={id}
            aria-hidden
            className="h-[3px] w-8 rounded-full transition-colors"
            style={{
              background: reached
                ? "rgb(var(--brand-primary))"
                : "rgb(var(--border-subtle))",
            }}
          />
        );
      })}
    </div>
  );
}
