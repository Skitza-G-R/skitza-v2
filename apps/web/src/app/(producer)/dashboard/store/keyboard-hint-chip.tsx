// keyboard-hint-chip.tsx
//
// Small monospace key-cap rendered next to buttons (e.g. the "+ New
// product" button shows "N"; the search input shows "/"). Decorative
// only, the actual key handling lives on the parent surface.

interface KeyboardHintChipProps {
  label: string;
}

export function KeyboardHintChip({ label }: KeyboardHintChipProps) {
  return (
    <kbd
      aria-hidden
      className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1 font-mono text-[10px] font-bold text-[rgb(var(--fg-muted))]"
    >
      {label}
    </kbd>
  );
}
