"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Floating action bar shown when 1+ items are selected in a bulk-
// select list surface. Portal-rendered so it sits above any
// page-level stacking context (Today + Projects both have layered
// sections that would otherwise clip a relatively-positioned bar).
//
// The Gmail / Linear pattern:
//   - bar slides up from the bottom center of the viewport
//   - shows the count + a set of action buttons
//   - esc clears the selection (handled by the caller; we just
//     expose `onDismiss` for the close button)
//
// The caller owns selection state; this component is a dumb render
// surface. Consistency between Today and Projects comes from both
// feeding it the same BulkAction shape.

export type BulkAction = {
  id: string;
  label: string;
  onClick: () => void | Promise<void>;
  // "destructive" paints the button amber/red to signal archive /
  // delete semantics. "primary" emphasizes the most-expected action
  // (mark read). Left unset → neutral button.
  tone?: "destructive" | "primary";
  // When true, the button shows a muted disabled style and ignores
  // clicks — used during mutation-in-flight to prevent double-fire.
  disabled?: boolean;
};

type Props = {
  // Non-zero → the bar is visible. Zero → component returns null
  // (no need for an exit transition; the portal unmount is instant).
  count: number;
  actions: BulkAction[];
  onDismiss: () => void;
};

export function BulkActionBar({ count, actions, onDismiss }: Props) {
  const [mounted, setMounted] = useState(false);

  // Next's SSR can't touch `document`; defer the portal until after
  // hydration.
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || count === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-label={`${String(count)} selected`}
      // Fixed-position centered pill. z=60 slots just under the
      // cheatsheet (z=55) and the command palette but above every
      // other page overlay. pointer-events-none on the outer
      // positioner so the bar doesn't intercept clicks on its own
      // side gutters.
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
    >
      <div className="sk-pop pointer-events-auto flex min-h-[56px] items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 shadow-[var(--shadow-md)] backdrop-blur-sm">
        <p className="sk-num font-mono text-xs text-[rgb(var(--fg-secondary))]">
          <span className="font-semibold text-[rgb(var(--fg-primary))]">
            {count}
          </span>{" "}
          selected
        </p>
        <span
          aria-hidden
          className="mx-1 h-4 w-px bg-[rgb(var(--border-subtle))]"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                if (a.disabled) return;
                void a.onClick();
              }}
              disabled={a.disabled}
              className={[
                "inline-flex min-h-9 items-center rounded-[var(--radius-sm)] px-3 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
                a.tone === "destructive"
                  ? "border border-[rgb(var(--fg-warning)/0.4)] text-[rgb(var(--fg-warning))] hover:bg-[rgb(var(--fg-warning)/0.08)]"
                  : a.tone === "primary"
                    ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] hover:brightness-110"
                    : "border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-overlay))]",
                a.disabled ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Clear selection"
          onClick={onDismiss}
          className="ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}

// Tiny reducer-style hook for managing a Set<string> of selected ids.
// Kept in the same module so every surface that uses the bar gets
// the same semantics for free:
//   - toggle(id) adds / removes
//   - clear() drops everything
//   - Esc listener wired by `useEscClears(selection, clear)`
//
// We expose a Set rather than an array so O(1) membership checks
// keep row renders cheap on lists in the 50–200 range.
export function useBulkSelection() {
  const [selection, setSelection] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const setMany = (ids: string[], select: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const clear = () => {
    setSelection(new Set());
  };

  return { selection, toggle, setMany, clear };
}

// Wire Esc → clear. Skips when the user is typing in a form field so
// we don't eat the Escape key in a modal's own input.
export function useEscClearsSelection(
  hasSelection: boolean,
  onClear: () => void,
) {
  useEffect(() => {
    if (!hasSelection) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        if (
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      onClear();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [hasSelection, onClear]);
}
