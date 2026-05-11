// step-bar.tsx
//
// Horizontal segmented progress bar for the editor wizard. Brand-amber
// fills past + current steps; the rest are muted. Pure presentation.

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
      className="flex items-center gap-1"
    >
      {steps.map((id, idx) => {
        const reached = idx <= currentIdx;
        return (
          <span
            key={id}
            aria-hidden
            className="h-[3px] flex-1 rounded-full transition-colors"
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
