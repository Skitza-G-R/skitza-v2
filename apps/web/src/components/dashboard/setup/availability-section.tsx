// Setup → Availability tab content. Lifted from /dashboard/booking?tab=
// sessions so the producer's weekly hours, blackouts, and session
// policies live directly inside the Setup tab instead of behind an
// "Edit hours & blackouts" cross-link.
//
// Server component. The five children are individual client islands
// (each owns its own optimistic-update behavior and pending state),
// stacked top-to-bottom in the order producers most often touch them:
//   1. GCal sync status   (read-only badge today; one-line OAuth ahead)
//   2. Default duration   (single dropdown — fastest knob to flip)
//   3. Session policies   (auto-confirm + cancellation hours)
//   4. Empty-hours hint   (only when no weekly windows exist yet)
//   5. Weekly windows     (the heaviest editor — multi-window per day)
//   6. Blackouts          (date ranges that suppress the windows)
//
// Same component is rendered from /dashboard/booking?tab=sessions so
// the two surfaces never drift. The page-level header (settings/page
// .tsx) owns the "When you're open" H1 + description; this component
// renders the editors only.

import { AvailabilityEditor } from "~/app/(app)/dashboard/booking/availability-editor";
import { BlackoutsEditor } from "~/app/(app)/dashboard/booking/blackouts-editor";
import { DurationPicker } from "~/app/(app)/dashboard/booking/duration-picker";
import { GCalSyncBadge } from "~/app/(app)/dashboard/booking/gcal-sync-badge";
import { PoliciesEditor } from "~/app/(app)/dashboard/booking/policies-editor";

export type AvailabilityBlock = {
  weekday: number;
  startMin: number;
  endMin: number;
};

export type Blackout = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

export type AvailabilitySettings = {
  defaultSessionMin: number;
  autoConfirmBookings: boolean;
  cancellationPolicyHours: number;
};

export function AvailabilitySection({
  blocks,
  blackouts,
  settings,
}: {
  blocks: AvailabilityBlock[];
  blackouts: Blackout[];
  settings: AvailabilitySettings;
}) {
  return (
    <div className="space-y-4">
      <GCalSyncBadge status="not_connected" />
      <DurationPicker initialDefaultMin={settings.defaultSessionMin} />
      <PoliciesEditor
        initialAutoConfirm={settings.autoConfirmBookings}
        initialCancellationHours={settings.cancellationPolicyHours}
      />
      {blocks.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-4">
          <p className="text-sm text-[rgb(var(--fg-primary))]">
            No weekly hours set — clients see no bookable slots.
          </p>
          <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
            Tick a day below and drop in e.g. Monday 10am–6pm to get started.
          </p>
        </div>
      ) : null}
      <AvailabilityEditor initialBlocks={blocks} />
      <BlackoutsEditor initialBlackouts={blackouts} />
    </div>
  );
}
