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
import { resolveArtistStudioId } from "~/lib/artist-studio-context";
import { writeArtistStudioPreferenceCookie } from "~/lib/artist-studio-preference-client";
import type { Studio } from "~/server/artist/identity";

import { artistStudioSwitchHref } from "./studio-switch-destination";

// Server-resolved studio list (artist.studios). Zero and one studio are
// static identities; two or more use the shared accessible Dialog.
// Picking a studio swaps ?studio=<id> on safe tab roots. Resource detail
// paths belong to one producer, so switching there first returns to the
// matching studio-safe root (see studio-switch-destination.ts).
export function StudioSwitcher({
  studios,
  userId,
  initialStudioId,
  notificationStudioDotIds,
  previewOnly = false,
  inverse = false,
}: {
  studios: Studio[];
  userId: string;
  initialStudioId: string | null;
  notificationStudioDotIds: readonly string[];
  previewOnly?: boolean;
  inverse?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = resolveArtistStudioId(studios, searchParams.get("studio"), initialStudioId);
  const active = studios.find((studio) => studio.producerId === activeId);
  const studiosWithActivity = new Set(notificationStudioDotIds);

  if (!active) {
    return (
      <div
        role="status"
        className={`flex min-h-11 w-full min-w-0 items-center rounded-[var(--radius-lg)] px-2 py-1 text-sm ${
          inverse ? "text-[rgb(var(--fg-onsidebar)/0.64)]" : "text-[rgb(var(--fg-muted))]"
        }`}
      >
        No active studio
      </div>
    );
  }

  if (studios.length === 1) {
    return (
      <div
        className={`flex min-h-11 w-full max-w-full min-w-0 items-center gap-2 rounded-[var(--radius-lg)] px-2 py-1 ${
          inverse ? "text-[rgb(var(--fg-onsidebar))]" : "text-[rgb(var(--fg-default))]"
        }`}
      >
        <StudioAvatar studio={active} />
        <span className="font-display min-w-0 flex-1 truncate text-start text-sm tracking-tight">
          {active.name}
        </span>
        <StudioActivityDot visible={studiosWithActivity.has(active.producerId)} />
      </div>
    );
  }

  const urlFor = (producerId: string) => {
    return artistStudioSwitchHref(pathname, searchParams.toString(), producerId);
  };

  const pick = (producerId: string) => {
    setOpen(false);
    if (previewOnly) return;
    writeArtistStudioPreferenceCookie(userId, producerId);
    if (producerId === active.producerId) return;
    router.push(urlFor(producerId));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`sk-press flex min-h-11 w-full max-w-full min-w-0 items-center gap-2 rounded-[var(--radius-lg)] border px-2 py-1 transition-colors ${
            inverse
              ? "border-[rgb(var(--border-sidebar))] bg-[rgb(var(--fg-onsidebar)/0.04)] text-[rgb(var(--fg-onsidebar))] hover:bg-[rgb(var(--fg-onsidebar)/0.09)]"
              : "border-transparent text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-sunken))]"
          }`}
        >
          <StudioAvatar studio={active} />
          <span className="font-display min-w-0 flex-1 truncate text-start text-sm tracking-tight">
            {active.name}
          </span>
          <StudioActivityDot visible={studiosWithActivity.has(active.producerId)} />
          <span
            aria-hidden
            className={`shrink-0 text-xs ${
              inverse ? "text-[rgb(var(--fg-onsidebar)/0.5)]" : "text-[rgb(var(--fg-muted))]"
            }`}
          >
            ▾
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="gap-0 p-4 sm:max-w-sm">
        <DialogTitle className="pr-8">Pick a studio</DialogTitle>
        <DialogDescription className="mt-1 mb-3 pr-8 text-xs">
          Choose which studio you want to view.
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
                  <StudioActivityDot visible={studiosWithActivity.has(studio.producerId)} />
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

function StudioActivityDot({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      aria-label="New activity from this studio"
      className="h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
    />
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
