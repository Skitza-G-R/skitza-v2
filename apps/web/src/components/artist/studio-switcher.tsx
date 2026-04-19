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
export function StudioSwitcher({ studios }: { studios: Studio[] }) {
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

  // Single studio: static chip, no dropdown
  if (studios.length <= 1) {
    return (
      <div className="flex items-center gap-2">
        <StudioAvatar studio={active} />
        <span className="font-display text-sm tracking-tight">{active.name}</span>
      </div>
    );
  }

  // Multi-studio: clickable chip + dropdown
  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[rgb(var(--bg-sunken))]"
      >
        <StudioAvatar studio={active} />
        <span className="font-display text-sm tracking-tight">{active.name}</span>
        <span aria-hidden className="text-xs text-[rgb(var(--fg-muted))]">▾</span>
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
