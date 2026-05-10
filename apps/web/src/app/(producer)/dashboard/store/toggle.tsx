// toggle.tsx
//
// 44×24 visibility toggle with springy thumb. The "on" state uses the
// success token (--fg-success); the "off" state uses --border-strong.
// Driven by a controlled `on` prop and an `onChange` callback so the
// parent owns the transition (so a server-action revert can flip state
// back without lag).

"use client";

interface ToggleProps {
  on: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
}

export function Toggle({ on, onChange, ariaLabel, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-pressed={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className="relative shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 disabled:opacity-50"
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: on
          ? "rgb(var(--fg-success))"
          : "rgb(var(--border-strong))",
      }}
    >
      <span
        aria-hidden
        className="absolute top-[3px] inline-block bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          left: on ? 23 : 3,
          transition: "left 220ms cubic-bezier(.34,1.56,.64,1)",
        }}
      />
    </button>
  );
}
