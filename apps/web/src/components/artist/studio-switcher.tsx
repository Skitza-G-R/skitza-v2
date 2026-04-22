"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Studio } from "~/server/artist/identity";

// Server-resolved initial list. When the artist has 2+ studios,
// opens a dropdown that swaps the active studio via the ?studio=
// URL param. Tabs read that param server-side to scope data.
//
// When studios.length === 1, renders as a non-interactive chip —
// no dropdown chevron, no click affordance.
//
// 2026-04-22 — `compact` mode added for the collapsed desktop
// sidebar. When compact=true, only the studio avatar renders — no
// name, no chevron. The dropdown still opens on click (assuming
// the user has multiple studios) so switching remains possible
// even in the 56px collapsed rail. Fix for the Phase 2+3 audit's
// "StudioSwitcher disappears in collapsed sidebar" finding.
export function StudioSwitcher({
  studios,
  compact = false,
}: {
  studios: Studio[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = searchParams.get("studio") ?? studios[0]?.producerId;
  const active = studios.find((s) => s.producerId === activeId) ?? studios[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  if (!active) return null;

  // Build a URL preserving the current tab path but swapping ?studio=
  const urlFor = (producerId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("studio", producerId);
    return `${pathname}?${params.toString()}`;
  };

  // Single studio: static chip (full) or just avatar (compact). No dropdown.
  if (studios.length <= 1) {
    if (compact) {
      return (
        <div className="flex justify-center" title={active.name}>
          <StudioAvatar studio={active} />
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <StudioAvatar studio={active} />
        <span className="font-display text-sm tracking-tight">{active.name}</span>
      </div>
    );
  }

  // Multi-studio: clickable chip (full) or avatar-only button (compact) + dropdown
  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={compact ? `Current studio: ${active.name}. Click to switch.` : undefined}
        {...(compact ? { title: `${active.name} — click to switch studio` } : {})}
        className={
          compact
            ? "flex items-center justify-center rounded-md p-1 transition-colors hover:bg-[rgb(var(--bg-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
            : "flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[rgb(var(--bg-sunken))]"
        }
      >
        <StudioAvatar studio={active} />
        {!compact && (
          <>
            <span className="font-display text-sm tracking-tight">{active.name}</span>
            <span aria-hidden className="text-xs text-[rgb(var(--fg-muted))]">▾</span>
          </>
        )}
      </button>
      {open ? (
        <ul
          role="listbox"
          className="sk-pop absolute left-0 top-full z-40 mt-1 min-w-[220px] rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] py-1 shadow-lg"
        >
          {studios.map((studio) => (
            <li key={studio.producerId}>
              <Link
                href={urlFor(studio.producerId)}
                onClick={() => {
                  setOpen(false);
                }}
                role="option"
                aria-selected={studio.producerId === active.producerId}
                className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-[rgb(var(--bg-sunken))] ${
                  studio.producerId === active.producerId
                    ? "text-[rgb(var(--brand-primary))]"
                    : "text-[rgb(var(--fg-primary))]"
                }`}
              >
                <StudioAvatar studio={studio} />
                <span className="truncate">{studio.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StudioAvatar({ studio }: { studio: Studio }) {
  if (studio.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={studio.logoUrl}
        alt=""
        className="h-6 w-6 rounded-full object-cover"
      />
    );
  }
  // Fallback: first initial in a brand-colored circle
  const initial = studio.name.charAt(0).toUpperCase();
  return (
    <div
      aria-hidden
      className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[0.65rem] font-semibold text-[rgb(var(--bg-base))]"
    >
      {initial}
    </div>
  );
}
