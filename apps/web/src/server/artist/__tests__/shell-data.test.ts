import { describe, it, expect } from "vitest";

import { computeArtistUnreadCount } from "../shell-data";

// Pure unit tests for the unread count math used by the artist
// topbar bell dot. The orchestration in `getArtistShellState` (auth,
// tRPC caller, Promise.allSettled, React.cache) is integration glue —
// the math itself is what we want pinned.
//
// Composition (per SK-31, confirmed with Gili 2026-05-23):
//   • # pending payments
//   • # upcoming confirmed sessions within next 7 days
//   • + 1 if latestMix exists AND was uploaded in the last 7 days

const NOW = new Date("2026-05-23T12:00:00Z");

function hoursAhead(h: number): Date {
  return new Date(NOW.getTime() + h * 60 * 60 * 1000);
}
function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000);
}

describe("computeArtistUnreadCount", () => {
  it("returns 0 when there's nothing to act on", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [],
          latestMix: null,
          pendingPayments: [],
        },
        NOW,
      ),
    ).toBe(0);
  });

  it("counts each pending payment", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [],
          latestMix: null,
          pendingPayments: [{}, {}, {}],
        },
        NOW,
      ),
    ).toBe(3);
  });

  it("counts only sessions within the next 7 days", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [
            { startsAt: hoursAhead(2) }, // ✓ in 2h — counts
            { startsAt: hoursAhead(24 * 6) }, // ✓ in 6d — counts
            { startsAt: hoursAhead(24 * 7) }, // ✓ exactly 7d — counts (boundary inclusive)
            { startsAt: hoursAhead(24 * 8) }, // ✗ in 8d — past window
            { startsAt: hoursAgo(2) }, // ✗ already passed — past window
          ],
          latestMix: null,
          pendingPayments: [],
        },
        NOW,
      ),
    ).toBe(3);
  });

  it("adds +1 when latestMix was uploaded in the last 7 days", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [],
          latestMix: { uploadedAt: hoursAgo(24 * 3) }, // 3 days ago
          pendingPayments: [],
        },
        NOW,
      ),
    ).toBe(1);
  });

  it("does NOT add for a latestMix older than 7 days", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [],
          latestMix: { uploadedAt: hoursAgo(24 * 8) }, // 8 days ago
          pendingPayments: [],
        },
        NOW,
      ),
    ).toBe(0);
  });

  it("treats latestMix exactly 7 days old as still recent (boundary inclusive)", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [],
          latestMix: { uploadedAt: hoursAgo(24 * 7) },
          pendingPayments: [],
        },
        NOW,
      ),
    ).toBe(1);
  });

  it("does NOT add for a missing latestMix", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [],
          latestMix: null,
          pendingPayments: [],
        },
        NOW,
      ),
    ).toBe(0);
  });

  it("sums all three contributions together", () => {
    expect(
      computeArtistUnreadCount(
        {
          upcomingSessions: [
            { startsAt: hoursAhead(2) },
            { startsAt: hoursAhead(48) },
          ],
          latestMix: { uploadedAt: hoursAgo(12) },
          pendingPayments: [{}, {}],
        },
        NOW,
      ),
    ).toBe(2 + 2 + 1);
  });
});
