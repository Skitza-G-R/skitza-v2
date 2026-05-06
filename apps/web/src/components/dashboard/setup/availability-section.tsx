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

import { AvailabilityEditor } from "~/app/(producer)/dashboard/booking/availability-editor";
import { BlackoutsEditor } from "~/app/(producer)/dashboard/booking/blackouts-editor";
import { DurationPicker } from "~/app/(producer)/dashboard/booking/duration-picker";
import { GCalSyncBadge } from "~/app/(producer)/dashboard/booking/gcal-sync-badge";
import { PoliciesEditor } from "~/app/(producer)/dashboard/booking/policies-editor";

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
  hideDurationPicker = false,
}: {
  blocks: AvailabilityBlock[];
  blackouts: Blackout[];
  settings: AvailabilitySettings;
  /**
   * Hides the producer-level default-session-length picker. Used by the
   * onboarding wizard's Step 3, where the producer just set their per-
   * service duration in Step 2 and asking again here would feel like a
   * duplicate question. Setup → Availability still shows the picker so
   * the global default can be tuned later.
   */
  hideDurationPicker?: boolean;
}) {
  return (
    <div className="space-y-3">
      <GCalSyncBadge status="not_connected" />
      {hideDurationPicker ? null : (
        <DurationPicker initialDefaultMin={settings.defaultSessionMin} />
      )}
      <PoliciesEditor
        initialAutoConfirm={settings.autoConfirmBookings}
        initialCancellationHours={settings.cancellationPolicyHours}
      />
      {blocks.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border-l-2 border-[rgb(var(--brand-primary))] bg-[rgb(var(--bg-overlay)/0.5)] px-3 py-1.5 text-[0.66rem] text-[rgb(var(--fg-secondary))]">
          <span className="font-semibold text-[rgb(var(--fg-primary))]">
            No weekly hours set.
          </span>{" "}
          Pick a day below and add a window to open it for booking.
        </p>
      ) : null}
      <AvailabilityEditor initialBlocks={blocks} />
      <BlackoutsEditor initialBlackouts={blackouts} />
    </div>
  );
}
