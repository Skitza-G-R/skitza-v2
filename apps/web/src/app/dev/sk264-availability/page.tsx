import { notFound } from "next/navigation";

import { AvailabilityPanel } from "~/app/(producer)/dashboard/calendar/availability-panel";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

// SK-264 visual check — the Calendar Availability tab seeded with the
// exact Monday from the bug report: five windows including one that
// ends at midnight and one overlapping it. Lets the inline day error,
// the truthful 24:00 end option, the hidden + Add window at the cap,
// and the blocked Save be inspected without a signed-in producer.
// Saving hits the real server action and fails with "Please sign in",
// which is expected here.

const BLOCKS = [
  { weekday: 0, startMin: 10 * 60, endMin: 14 * 60 },
  { weekday: 0, startMin: 15 * 60, endMin: 20 * 60 },
  { weekday: 1, startMin: 10 * 60, endMin: 14 * 60 },
  { weekday: 1, startMin: 15 * 60, endMin: 20 * 60 },
  { weekday: 1, startMin: 20 * 60, endMin: 22 * 60 },
  { weekday: 1, startMin: 22 * 60, endMin: 24 * 60 },
  { weekday: 1, startMin: 23 * 60, endMin: 24 * 60 },
  { weekday: 2, startMin: 10 * 60, endMin: 14 * 60 },
  { weekday: 3, startMin: 10 * 60, endMin: 14 * 60 },
  { weekday: 4, startMin: 10 * 60, endMin: 14 * 60 },
];

export default function Sk264AvailabilityVisualCheck() {
  if (!isDevGalleryAvailable()) notFound();
  return (
    <main className="mx-auto max-w-[1180px] px-4 py-8">
      <h1 className="font-display mb-4 text-[22px] font-extrabold text-[rgb(var(--fg-default))]">
        SK-264 · Availability tab visual check
      </h1>
      <AvailabilityPanel
        blocks={BLOCKS}
        blackouts={[]}
        settings={{
          autoConfirmBookings: false,
          cancellationPolicyHours: 24,
          maxSessionsPerDay: 2,
        }}
        initialWeekStart="sunday"
        timeZone="Asia/Jerusalem"
        initialNow="2026-08-23T12:00:00.000Z"
      />
    </main>
  );
}
