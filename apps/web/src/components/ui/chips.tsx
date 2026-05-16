"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode } from "react";

import { cn } from "~/lib/cn";

// Chips — locked design system (Phase 4).
//
// One primitive, two composition patterns:
//
//   1. Filter chips — parent owns state via `value` + `onChange`.
//      Most common (every list view: Clients, Music, Storefront).
//
//   2. URL-driven tab toggles — parent reads the URL via the
//      `useChipsParam(name, fallback)` hook below, and passes the
//      same `{ value, onChange }` shape into <Chips>. Click writes to
//      the URL; nav back/forward is correct.
//
// Items can also carry `href` for pure navigation chips (the chip is
// rendered as a `<Link>` instead of a `<button>`). `value` is still
// passed so the active item is visually highlighted via `aria-current`.
//
// Visual contract:
// - Horizontal scroll row with momentum-friendly overflow (`flex gap-2
//   overflow-x-auto`). Negative inline margin + padding lets the first
//   and last chips reach the parent edge while the active glow stays
//   inside the rail.
// - Inactive: `border-subtle` hairline, `bg-elevated`, muted text.
//   Hover lifts text to `fg-default` (no background swap — the chip
//   stays calm in a dense filter row).
// - Active: amber border + `brand-primary/0.08` tint + amber text.
//   Reads as the locked design's "single accent, used sparingly" rule.
// - Count badges (the `count` prop) render in JetBrains Mono with
//   tabular-nums — financial-figure styling for "all · 12" patterns.
// - `sk-press` on every interactive chip for the locked tactile
//   feedback (scale 0.94 active, 1.05 hover brightness).
//
// ARIA:
// - Wrapper: `role="group"` + `aria-label` (consumer-provided).
// - Button mode: `aria-pressed={selected}` — the standard filter-chip
//   semantic. Strict `role="tab"` + arrow-key navigation is overkill
//   for the use cases in v1 (filter rows, not strict tab panels).
// - Link mode: `aria-current="page"` on the active item.

export interface ChipItem<T extends string> {
  value: T;
  label: string;
  /** Optional count badge after the label (e.g. "All · 12"). */
  count?: number | null;
  /**
   * When set, the chip renders as a `<Link>` and onChange is ignored.
   * Use for nav-style chips (e.g. cross-page tab strips).
   */
  href?: string;
}

export interface ChipsProps<T extends string> {
  /** Visible label for assistive tech (e.g. "Filter clients"). */
  ariaLabel: string;
  items: ChipItem<T>[];
  /** Currently selected value. Compared by strict equality with `item.value`. */
  value: T;
  /** Required for button mode. Ignored when items carry `href`. */
  onChange?: (next: T) => void;
  className?: string;
}

export function Chips<T extends string>({
  ariaLabel,
  items,
  value,
  onChange,
  className,
}: ChipsProps<T>): ReactNode {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        // Negative gutter lets first/last chip touch the parent edge
        // while keeping the focus ring inside.
        "-mx-2 flex gap-2 overflow-x-auto px-2 pb-1",
        // Hide scrollbar visually; the row is finger-scrollable on
        // mobile and Shift+wheel-scrollable on trackpad.
        "scrollbar-thin",
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const inner = (
          <>
            <span>{item.label}</span>
            {item.count != null && item.count > 0 && (
              <span
                aria-hidden
                className="font-mono text-[10px] tabular-nums opacity-70"
              >
                {item.count}
              </span>
            )}
          </>
        );
        const className = cn(
          // min-h-[44px] on mobile (Skitza tap-target rule); collapses
          // to py-1.5 (~30px) on sm+ to keep the pill compact on
          // desktop where mouse precision is higher.
          "sk-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-lg)] border px-3 py-2.5 text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]",
          selected
            ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary))]"
            : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
        );

        if (item.href) {
          return (
            <Link
              key={item.value}
              href={item.href}
              aria-current={selected ? "page" : undefined}
              className={className}
            >
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={selected}
            disabled={!onChange}
            onClick={
              onChange
                ? () => {
                    onChange(item.value);
                  }
                : undefined
            }
            className={className}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

// URL-driven tab-toggle helper. Reads `name` out of the URL query
// (falling back to `fallback`), and returns the `{ value, onChange }`
// shape <Chips> consumes. Calling `onChange(next)` writes to the URL
// via `router.replace` with `scroll: false` — the tab swap stays in
// place and back/forward navigation is correct.
//
// Example:
//   const { value, onChange } = useChipsParam("tab", "projects");
//   <Chips ariaLabel="View" value={value} onChange={onChange}
//     items={[
//       { value: "projects", label: "Projects" },
//       { value: "clients", label: "Clients" },
//     ]} />
export function useChipsParam<T extends string>(
  name: string,
  fallback: T,
): { value: T; onChange: (next: T) => void } {
  const sp = useSearchParams();
  const router = useRouter();
  const value = (sp.get(name) as T | null) ?? fallback;
  const onChange = (next: T) => {
    const params = new URLSearchParams(sp.toString());
    params.set(name, next);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  return { value, onChange };
}
