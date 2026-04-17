"use client";

import type { ReactNode } from "react";

import { cn } from "~/lib/cn";
import { FIELD_LABELS, type FieldType } from "~/lib/contracts/editor-helpers";

// Left-rail field-type picker. Click to arm a type for placement; the
// next click on the page canvas drops a default-sized rect at the
// cursor and selects it. Clicking the armed type again disarms it,
// which is the escape-hatch for "I changed my mind" without clicking
// the canvas first.

const ORDER: FieldType[] = [
  "signature",
  "initial",
  "date",
  "text",
  "checkbox",
  "dropdown",
  "number",
];

interface FieldPaletteProps {
  pendingPlaceType: FieldType | null;
  onArm: (type: FieldType | null) => void;
  disabled?: boolean;
}

export function FieldPalette({
  pendingPlaceType,
  onArm,
  disabled,
}: FieldPaletteProps) {
  return (
    <aside
      aria-label="Field palette"
      className="flex w-full shrink-0 flex-col gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 md:w-[240px]"
    >
      <p className="px-2 pb-1 pt-1 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Fields
      </p>
      {ORDER.map((t) => {
        const armed = pendingPlaceType === t;
        return (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => {
              onArm(armed ? null : t);
            }}
            className={cn(
              "group flex items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-left text-sm transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
              armed
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
                : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]",
              disabled ? "pointer-events-none opacity-50" : "",
            )}
          >
            <span className="flex items-center gap-2">
              <FieldIcon type={t} />
              {FIELD_LABELS[t]}
            </span>
            {armed ? (
              <span
                aria-hidden
                className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]"
              >
                Placing…
              </span>
            ) : null}
          </button>
        );
      })}
      <p className="mt-2 px-2 pb-1 font-mono text-[0.6rem] leading-relaxed text-[rgb(var(--fg-muted))]">
        Pick a field, then click the page to drop it. Drag to move; corner
        handle resizes.
      </p>
    </aside>
  );
}

function FieldIcon({ type }: { type: FieldType }): ReactNode {
  const base =
    "h-4 w-4 shrink-0 text-[rgb(var(--fg-secondary))] group-hover:text-[rgb(var(--fg-primary))]";
  switch (type) {
    case "signature":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className={base}>
          <path
            d="M3 17c4-6 7 0 11-3s6-2 7 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M3 20h18"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "initial":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className={base}>
          <text
            x="12"
            y="17"
            textAnchor="middle"
            fontSize="13"
            fontFamily="monospace"
            fill="currentColor"
          >
            AB
          </text>
        </svg>
      );
    case "date":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className={base}>
          <rect
            x="3.5"
            y="5.5"
            width="17"
            height="15"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "text":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className={base}>
          <path
            d="M4 6h16M6 12h12M4 18h10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "checkbox":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className={base}>
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M8 12l3 3 5-6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "dropdown":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className={base}>
          <rect
            x="3"
            y="7"
            width="18"
            height="10"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M9 11l3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "number":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className={base}>
          <text
            x="12"
            y="17"
            textAnchor="middle"
            fontSize="13"
            fontFamily="monospace"
            fill="currentColor"
          >
            123
          </text>
        </svg>
      );
  }
}
