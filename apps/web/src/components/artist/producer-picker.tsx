"use client";

import { ProducerAvatar } from "./producer-avatar";

type Studio = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

// Producer picker — locked design system (Phase 5).
//
// Horizontal scrollable carousel of circular gradient avatars (one per
// connected studio). Selected avatar gets a brand-primary ring; others
// dim slightly. Initials fall through to the deterministic gradient
// from `producer-color.ts` when no logoUrl is set.
//
// Hidden when only one studio is connected — there's nothing to pick.

export function ProducerPicker({
  studios,
  activeId,
  onSelect,
}: {
  studios: Studio[];
  activeId: string | null;
  onSelect: (producerId: string) => void;
}) {
  if (studios.length <= 1) return null;
  return (
    <div>
      <p className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        Choose a producer
      </p>
      <div className="sk-scroll-x -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {studios.map((studio) => {
          const active = studio.producerId === activeId;
          return (
            <button
              key={studio.producerId}
              type="button"
              onClick={() => {
                onSelect(studio.producerId);
              }}
              aria-pressed={active}
              className="sk-press flex shrink-0 flex-col items-center gap-1.5 focus-visible:outline-none"
            >
              {studio.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={studio.logoUrl}
                  alt=""
                  className={`h-14 w-14 rounded-full object-cover transition-shadow ${
                    active
                      ? "ring-2 ring-[rgb(var(--brand-primary))] ring-offset-2 ring-offset-[rgb(var(--bg-background))]"
                      : "opacity-65"
                  }`}
                />
              ) : (
                <div
                  className={`rounded-full transition-shadow ${
                    active
                      ? "ring-2 ring-[rgb(var(--brand-primary))] ring-offset-2 ring-offset-[rgb(var(--bg-background))]"
                      : "opacity-65"
                  }`}
                >
                  <ProducerAvatar
                    name={studio.name}
                    size={56}
                    square={false}
                  />
                </div>
              )}
              <span
                className={`max-w-[64px] truncate text-center font-mono text-[10px] tracking-wider ${
                  active
                    ? "font-bold text-[rgb(var(--fg-default))]"
                    : "text-[rgb(var(--fg-muted))]"
                }`}
              >
                {studio.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
