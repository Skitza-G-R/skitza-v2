"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import type { Studio } from "~/server/artist/identity";

import { artistStudioSwitchHref } from "./studio-switch-destination";

// Server-resolved studio list (artist.studios). The trigger always
// opens the shared accessible Dialog (mobile bottom sheet, centered
// desktop modal), even for single-studio artists. Picking a studio
// swaps ?studio=<id> on safe tab roots. Resource detail paths belong
// to one producer, so switching there first returns to the matching
// studio-safe root (see studio-switch-destination.ts).
export function StudioSwitcher({ studios }: { studios: Studio[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = searchParams.get("studio") ?? studios[0]?.producerId;
  const active = studios.find((s) => s.producerId === activeId) ?? studios[0];

  if (!active) return null;

  const urlFor = (producerId: string) => {
    return artistStudioSwitchHref(pathname, searchParams.toString(), producerId);
  };

  const pick = (producerId: string) => {
    setOpen(false);
    if (producerId === active.producerId) return;
    router.push(urlFor(producerId));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="sk-press flex min-h-11 w-full max-w-full min-w-0 items-center gap-2 rounded-[var(--radius-lg)] px-2 py-1 transition-colors hover:bg-[rgb(var(--bg-sunken))]"
        >
          <StudioAvatar studio={active} />
          <span className="font-display min-w-0 flex-1 truncate text-start text-sm tracking-tight">
            {active.name}
          </span>
          <span aria-hidden className="shrink-0 text-xs text-[rgb(var(--fg-muted))]">
            ▾
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="gap-0 p-4 sm:max-w-sm">
        <DialogTitle className="pr-8">Pick a studio</DialogTitle>
        <DialogDescription className="mt-1 mb-3 pr-8 text-xs">
          {studios.length === 1
            ? "You’re connected to one studio. Visit another producer’s link to add it."
            : "Choose which studio you want to view."}
        </DialogDescription>
        <ul className="space-y-1">
          {studios.map((studio) => {
            const isActive = studio.producerId === active.producerId;
            return (
              <li key={studio.producerId}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    pick(studio.producerId);
                  }}
                  className={`sk-press flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-lg)] p-2 text-left transition-colors hover:bg-[rgb(var(--bg-sunken))] ${
                    isActive ? "bg-[rgb(var(--brand-primary)/0.08)]" : ""
                  }`}
                >
                  <StudioAvatar studio={studio} />
                  <span
                    className={`font-display min-w-0 flex-1 truncate text-sm font-bold tracking-tight ${
                      isActive
                        ? "text-[rgb(var(--brand-primary))]"
                        : "text-[rgb(var(--fg-primary))]"
                    }`}
                  >
                    {studio.name}
                  </span>
                  {isActive ? (
                    <span className="shrink-0 font-mono text-[0.6rem] font-semibold tracking-wider text-[rgb(var(--brand-primary))] uppercase">
                      Current
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function StudioAvatar({ studio }: { studio: Studio }) {
  if (studio.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={studio.logoUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
    );
  }
  const initial = studio.name.charAt(0).toUpperCase();
  return (
    <div
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[0.65rem] font-semibold text-[rgb(var(--bg-base))]"
    >
      {initial}
    </div>
  );
}
