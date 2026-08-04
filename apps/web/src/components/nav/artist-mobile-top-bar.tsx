"use client";

import { useSearchParams } from "next/navigation";

import { StudioSwitcher } from "~/components/artist/studio-switcher";
import { ArtistNotificationBell } from "~/components/artist/artist-notification-bell";
import { resolveArtistStudioId, withArtistStudio } from "~/lib/artist-studio-context";
import type { Studio } from "~/server/artist/identity";
import type { ProducerProfileStatus } from "~/server/auth/role";

import { ArtistMobileUserButton } from "./artist-user-button";
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
  userId,
  initialStudioId,
  notificationUnreadCount,
  notificationStudioDotIds,
  producerStatus,
  producerNotificationUnreadCount,
}: {
  studios: Studio[];
  userId: string;
  initialStudioId: string | null;
  notificationUnreadCount: number;
  notificationStudioDotIds: readonly string[];
  producerStatus: ProducerProfileStatus;
  producerNotificationUnreadCount: number;
}) {
  const searchParams = useSearchParams();
  const activeStudioId = resolveArtistStudioId(
    studios,
    searchParams.get("studio"),
    initialStudioId,
  );

  return (
    <header
      className="sk-safe-top sticky top-0 z-30 backdrop-blur-2xl lg:hidden"
      style={{
        background: "rgb(var(--bg-background) / 0.76)",
        borderBottom: "1px solid rgb(var(--border-subtle) / 0.72)",
        boxShadow: "0 10px 30px -24px rgb(var(--bg-sidebar) / 0.45)",
        WebkitBackdropFilter: "blur(28px) saturate(145%)",
      }}
    >
      <div
        className="flex items-center justify-between gap-3 py-3"
        style={{
          paddingInlineStart: "max(16px, env(safe-area-inset-left, 0px))",
          paddingInlineEnd: "max(16px, env(safe-area-inset-right, 0px))",
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0">
            <Wordmark size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <StudioSwitcher
              studios={studios}
              userId={userId}
              initialStudioId={initialStudioId}
              notificationStudioDotIds={notificationStudioDotIds}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ArtistNotificationBell initialUnreadCount={notificationUnreadCount} />
          <ArtistMobileUserButton
            userId={userId}
            producerStatus={producerStatus}
            producerUnreadCount={producerNotificationUnreadCount}
            paymentsHref={withArtistStudio("/artist/payments", activeStudioId)}
            settingsHref={withArtistStudio("/artist/settings", activeStudioId)}
            ringClassName="ring-[rgb(var(--border-subtle))]"
          />
        </div>
      </div>
    </header>
  );
}
