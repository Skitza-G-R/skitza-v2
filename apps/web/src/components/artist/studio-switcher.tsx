"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Studio } from "~/server/artist/identity";

// Server-resolved studio list (artist.studios). When the artist has
// 2+ studios, the trigger opens a centered modal — "Pick a studio" —
// with backdrop blur. Picking a studio swaps ?studio=<id> on the
// current path so every artist tab re-reads the selection on
// navigation. The URL (not a cookie) remains the source of truth, so
// deep-links from email / share copy / browser back work unchanged.
//
// Single-studio artists see a static chip — no modal, no chevron.
export function StudioSwitcher({ studios }: { studios: Studio[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = searchParams.get("studio") ?? studios[0]?.producerId;
  const active = studios.find((s) => s.producerId === activeId) ?? studios[0];

  // Esc closes the modal — match the browser's mental model for any
  // overlay surface. Click-outside is handled by the backdrop button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;

  const urlFor = (producerId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("studio", producerId);
    return `${pathname}?${params.toString()}`;
  };

  const pick = (producerId: string) => {
    setOpen(false);
    if (producerId === active.producerId) return;
    router.push(urlFor(producerId));
  };

  // Single studio: static chip, no overlay.
  if (studios.length <= 1) {
    return (
      <div className="flex items-center gap-2">
        <StudioAvatar studio={active} />
        <span className="font-display text-sm tracking-tight">
          {active.name}
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="sk-press flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[rgb(var(--bg-sunken))]"
      >
        <StudioAvatar studio={active} />
        <span className="font-display text-sm tracking-tight">
          {active.name}
        </span>
        <span aria-hidden className="text-xs text-[rgb(var(--fg-muted))]">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pick a studio"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-8 backdrop-blur-sm"
        >
          {/* Backdrop click target — separate from the modal body so a
              click outside dismisses without bubbling into the list. */}
          <button
            type="button"
            aria-label="Close studio picker"
            onClick={() => {
              setOpen(false);
            }}
            className="absolute inset-0 cursor-default"
            tabIndex={-1}
          />
          <div className="relative mt-20 w-full max-w-sm rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-lg)]">
            <h3 className="mb-3 font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              Pick a studio
            </h3>
            <ul role="listbox" className="space-y-1">
              {studios.map((studio) => {
                const isActive = studio.producerId === active.producerId;
                return (
                  <li key={studio.producerId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        pick(studio.producerId);
                      }}
                      className={`sk-press flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-[rgb(var(--bg-sunken))] ${
                        isActive
                          ? "bg-[rgb(var(--brand-primary)/0.08)]"
                          : ""
                      }`}
                    >
                      <StudioAvatar studio={studio} />
                      <span
                        className={`min-w-0 flex-1 truncate font-display text-sm font-bold tracking-tight ${
                          isActive
                            ? "text-[rgb(var(--brand-primary))]"
                            : "text-[rgb(var(--fg-primary))]"
                        }`}
                      >
                        {studio.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
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
