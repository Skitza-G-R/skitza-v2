import { cache } from "react";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Request-scoped shell state for the artist side. Mirrors the producer
// `getShellState()` helper — wrapping in `React.cache()` means
// downstream server components (the artist layout passes the state to
// the app shell, which forwards `unreadCount` to the topbar) share a
// single set of SELECTs per render.
//
// `unreadCount` is the at-a-glance signal for the topbar bell dot. We
// don't yet track per-item read state on the artist side; the count is
// a proxy for "things to act on now":
//
//   • # of pending payments owed to producers
//   • # of upcoming confirmed sessions within the next 7 days
//   • + 1 if the artist's latest shared mix was uploaded in the last 7
//     days (single signal — there is at most one "latest" mix in the
//     existing home payload)
//
// Confirmed with Gili on SK-31 (2026-05-23): real read-state tracking
// is a separate follow-up; this proxy lights the dot when the artist
// has something to look at and stays dark otherwise.

const RECENT_MIX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const UPCOMING_SESSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface ArtistShellState {
  unreadCount: number;
}

const DEFAULT_STATE: ArtistShellState = { unreadCount: 0 };

// Pure (testable) input shape — the subset of artist.home /
// artist.book.myPendingPayments fields the unread count cares about.
// Kept narrow so call sites don't have to pass the whole payload and
// tests don't have to invent fixtures for unused fields.
export interface ArtistUnreadInputs {
  upcomingSessions: readonly { startsAt: Date }[];
  latestMix: { uploadedAt: Date } | null;
  pendingPayments: readonly unknown[];
}

// Pure helper — exported so `computeArtistUnreadCount` can be unit
// tested without mocking auth() or the tRPC caller. `now` is injected
// so tests pin their own clock.
export function computeArtistUnreadCount(
  input: ArtistUnreadInputs,
  now: Date,
): number {
  const nowMs = now.getTime();

  const pendingPaymentCount = input.pendingPayments.length;

  const upcomingWithin7d = input.upcomingSessions.filter((s) => {
    const ms = s.startsAt.getTime() - nowMs;
    return ms >= 0 && ms <= UPCOMING_SESSION_WINDOW_MS;
  }).length;

  const recentMix =
    input.latestMix !== null &&
    nowMs - input.latestMix.uploadedAt.getTime() <= RECENT_MIX_WINDOW_MS
      ? 1
      : 0;

  return pendingPaymentCount + upcomingWithin7d + recentMix;
}

export const getArtistShellState = cache(
  async (): Promise<ArtistShellState> => {
    const { userId } = await auth();
    if (!userId) return DEFAULT_STATE;

    const caller = appRouter.createCaller({ userId });

    // Parallelize the two reads; either failing makes the bell dark
    // (acceptable — the chrome should never crash the page).
    const [homeResult, paymentsResult] = await Promise.allSettled([
      caller.artist.home(),
      caller.artist.book.myPendingPayments(),
    ]);

    if (
      homeResult.status === "rejected" ||
      paymentsResult.status === "rejected"
    ) {
      return DEFAULT_STATE;
    }

    return {
      unreadCount: computeArtistUnreadCount(
        {
          upcomingSessions: homeResult.value.upcomingSessions,
          latestMix: homeResult.value.latestMix,
          pendingPayments: paymentsResult.value.bookings,
        },
        new Date(),
      ),
    };
  },
);
