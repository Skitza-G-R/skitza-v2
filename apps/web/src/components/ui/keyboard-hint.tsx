"use client";

import { cloneElement, isValidElement, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";

// Hover tooltip that surfaces a keyboard shortcut next to the wrapped
// control. Rolls a tiny Portal-based floating pill — no Radix Tooltip
// in the project yet, and adding that dep for one visual primitive
// is not worth the footprint.
//
// Usage:
//   <KeyboardHint shortcut="G T">
//     <Link href="/dashboard">Today</Link>
//   </KeyboardHint>
//
// The child must be a single React element that accepts a ref + the
// mouse/focus handlers; we merge them via cloneElement rather than
// wrapping the child in an extra DOM node (avoids breaking the
// parent's flex/grid assumptions).
//
// A11y:
//   - Tooltip is NOT announced to screen readers (aria-hidden). Real
//     a11y for shortcuts lives in the `?` cheatsheet, where SRs can
//     linearly scan them. The hover tooltip is purely a visual nudge
//     for sighted keyboard-curious users.
//   - Focus + mouse both trigger it, so tab-through users see it too.
//   - Reduced-motion: no scale/opacity transitions, instant show.

type Side = "top" | "bottom";

function getReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Parse a shortcut like "G T" or "⌘ K" into individual <kbd> chunks.
// Keys separated by spaces render as distinct boxes — matches the
// cheatsheet styling.
export function tokenizeShortcut(s: string): string[] {
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// Intrinsic props we care about merging into the child. `useLayoutEffect`
// below reads the DOM rect, so the child must render an HTMLElement.
type HoverProps = {
  ref?: React.Ref<HTMLElement>;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
};

export function KeyboardHint({
  shortcut,
  children,
  side = "bottom",
  /**
   * When true, don't render the tooltip — lets callers conditionally
   * suppress the hint on surfaces where it'd be redundant (the
   * cheatsheet itself, for instance).
   */
  disabled = false,
}: {
  shortcut: string;
  children: ReactNode;
  side?: Side;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useRef(false);

  useLayoutEffect(() => {
    reducedMotion.current = getReducedMotion();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Tooltip width is ~80-120px; a ~6px gap between the target and
    // the tooltip. We center the pill over the control and let the
    // viewport edge clamp below.
    const approxWidth = 110;
    let left = rect.left + rect.width / 2 - approxWidth / 2;
    left = Math.max(8, Math.min(window.innerWidth - approxWidth - 8, left));
    const top =
      side === "bottom"
        ? rect.top + rect.height + 6
        : rect.top - 28 - 6;
    setPos({ top, left });
  }, [open, side]);

  if (!isValidElement(children) || disabled) {
    return <>{children}</>;
  }

  const childEl = children as ReactElement<HoverProps>;
  const mergedProps: HoverProps = {
    ref: (node: HTMLElement | null) => {
      elRef.current = node;
      // Forward to any existing ref on the child. cloneElement hides
      // the original ref in the element.ref slot — merge if present.
      const existing = (childEl as unknown as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof existing === "function") existing(node);
      else if (existing && typeof existing === "object" && "current" in existing) {
        (existing as { current: HTMLElement | null }).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      setOpen(true);
      childEl.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      setOpen(false);
      childEl.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      setOpen(true);
      childEl.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      setOpen(false);
      childEl.props.onBlur?.(e);
    },
  };

  const cloned = cloneElement(childEl, mergedProps);

  return (
    <>
      {cloned}
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <span
              aria-hidden
              role="presentation"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                zIndex: 70,
              }}
              className={[
                "inline-flex items-center gap-1 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1 shadow-[var(--shadow-md)]",
                reducedMotion.current ? "" : "sk-pop",
              ].join(" ")}
            >
              {tokenizeShortcut(shortcut).map((tok, i) => (
                <kbd
                  key={i}
                  className="rounded border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-1 py-0.5 font-mono text-[0.65rem] text-[rgb(var(--fg-secondary))]"
                >
                  {tok}
                </kbd>
              ))}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
