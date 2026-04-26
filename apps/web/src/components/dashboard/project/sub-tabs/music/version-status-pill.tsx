"use client";

import { useEffect, useRef, useState } from "react";

import {
  pickStatusCopy,
  type StatusTone,
  type VersionStatus,
  type ViewerRole,
} from "./music-helpers";

// Story 05 — bilateral status pill. The pill itself is the trigger:
// click to open a dropdown of three options. Producer view shows
// Draft / Revisit / Final; artist view shows In progress / Needs work
// / Approved. Same DB enum, copy diverges via pickStatusCopy.
//
// Optimistic flips: the parent updates local state synchronously when
// onChange fires, then issues the mutation in the background. On error
// the parent is responsible for reverting + showing a toast (the pill
// itself doesn't know about mutations, just renders the displayed
// status).

interface VersionStatusPillProps {
  status: VersionStatus;
  viewerRole: ViewerRole;
  onChange: (status: VersionStatus) => void;
  /**
   * Disable the pill while a flip is in flight — guards against rapid
   * double-clicks queuing two mutations.
   */
  disabled?: boolean;
}

const STATUS_OPTIONS: VersionStatus[] = ["draft", "revisit", "final"];

// Tone → CSS-vars-only token mapping. Bound to the DB enum, NOT the
// viewer's role, so a "Final" pill (producer) and "Approved" pill
// (artist) light up the same brand-primary green.
function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case "positive":
      // Brand-primary at low alpha for the chip background; full
      // saturation for the text. Matches the "approved" badge family.
      return "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] border-[rgb(var(--brand-primary)/0.35)]";
    case "warn":
      // Amber via the warning fg token. Falls back to brand-accent if
      // --fg-warning isn't defined — never hex.
      return "bg-[rgb(var(--fg-warning)/0.12)] text-[rgb(var(--fg-warning))] border-[rgb(var(--fg-warning)/0.35)]";
    case "neutral":
      return "bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-muted))] border-[rgb(var(--border-subtle))]";
  }
}

export function VersionStatusPill({
  status,
  viewerRole,
  onChange,
  disabled = false,
}: VersionStatusPillProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const current = pickStatusCopy(status, viewerRole);

  // Click-outside + Escape — same shape as notification-bell.tsx so
  // the keyboard ergonomics feel consistent across the app.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSelect(s: VersionStatus) {
    setOpen(false);
    if (s === status) return;
    onChange(s);
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${current.label}. Click to change.`}
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className={[
          "sk-tap inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-[0.66rem] uppercase tracking-wider transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          toneClasses(current.tone),
        ].join(" ")}
      >
        <span>{current.label}</span>
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        >
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Change version status"
          // Anchored below + right of the pill so the dropdown reads
          // top-left → bottom-right (consistent with notification-bell
          // which anchors above-left). For a pill in the row's top-
          // right corner, opening below feels natural.
          className="sk-pop absolute right-0 top-full z-30 mt-1 min-w-[12rem] overflow-hidden rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-lg"
        >
          <ul className="py-1">
            {STATUS_OPTIONS.map((s) => {
              const opt = pickStatusCopy(s, viewerRole);
              const isCurrent = s === status;
              return (
                <li key={s}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleSelect(s);
                    }}
                    className={[
                      "sk-tap flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:bg-[rgb(var(--bg-overlay))]",
                      isCurrent
                        ? "bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-primary))]"
                        : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={[
                          "inline-block h-2 w-2 rounded-full",
                          opt.tone === "positive"
                            ? "bg-[rgb(var(--brand-primary))]"
                            : opt.tone === "warn"
                              ? "bg-[rgb(var(--fg-warning))]"
                              : "bg-[rgb(var(--fg-muted))]",
                        ].join(" ")}
                      />
                      {opt.label}
                    </span>
                    {isCurrent ? (
                      <span
                        aria-hidden="true"
                        className="font-mono text-[0.62rem] text-[rgb(var(--fg-muted))]"
                      >
                        ✓
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
