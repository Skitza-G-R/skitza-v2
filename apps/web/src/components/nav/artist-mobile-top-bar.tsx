import { UserButton } from "@clerk/nextjs";

import { StudioSwitcher } from "~/components/artist/studio-switcher";
import type { Studio } from "~/server/artist/identity";

import { Wordmark } from "./wordmark";

// ─── Artist mobile top bar (<lg) ───────────────────────────────────
//
// New Phase 2 design — warm `--bg-background` canvas (per locked
// design: artist mobile chrome reads light, only the bottom nav goes
// dark). Sticky to top, padded for the iOS notch via `sk-safe-top`.
//
// Layout:
//   - Leading: Skitza wordmark (small) + StudioSwitcher chip — gives
//     the artist a fast way to switch active studio context (the
//     existing multi-producer affordance) and roots the brand.
//   - Trailing: Clerk <UserButton> with avatar sized + ringed to
//     match the locked spec's "30px avatar with subtle ring".
//
// Phase 2 intentionally omits a per-name greeting block (the design's
// "Welcome back, Yael" header) — that data needs a tRPC fetch and
// leaks into page territory; will land in Phase 3 when individual
// artist pages are migrated.

export function ArtistMobileTopBar({
  studios,
}: {
  studios: Studio[];
}) {
  return (
    <header
      className="sk-safe-top sk-safe-x sticky top-0 z-30 flex items-center justify-between gap-3 backdrop-blur lg:hidden"
      style={{
        background: "rgb(var(--bg-background) / 0.92)",
        borderBottom: "1px solid rgb(var(--border-subtle))",
        padding: "12px 16px",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Wordmark size={18} />
        <StudioSwitcher studios={studios} />
      </div>
      <UserButton
        appearance={{
          elements: {
            avatarBox:
              "h-8 w-8 ring-1 ring-[rgb(var(--border-subtle))]",
          },
        }}
      />
    </header>
  );
}
