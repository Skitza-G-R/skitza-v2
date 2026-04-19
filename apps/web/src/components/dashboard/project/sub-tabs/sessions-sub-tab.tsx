"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { useToast } from "~/components/ui/toast";
import { fmtDateTime } from "~/lib/time/relative";

// Task 7 — Project Room Sessions sub-tab.
//
// Data-model reality: projects → bookings is a one-to-one FK
// (projects.bookingId). A project has AT MOST one linked booking. Multi-
// session-per-project is future work (a separate schema migration +
// router change); for MVP we surface just that single linked booking.
//
// This component therefore has two shapes:
//   1. `booking === null` → empty state. Copy points the producer at the
//      existing producer-initiated flow at /dashboard/booking?tab=upcoming.
//   2. `booking !== null` → single card with date + duration + package +
//      artist, plus Reschedule / Cancel buttons.
//
// Reschedule + Cancel are deliberate stubs — no server-side procedures
// exist yet for producer-side booking reschedule or cancel-after-confirm.
// The design-doc flags the full inline editing flow as future work.

// Matches the shape derived in page.tsx from caller.booking.list(). We
// intentionally keep this narrow: just the fields the sub-tab needs to
// render. Everything else (Stripe session ids, phone, notes) belongs in
// the booking detail page, not here.
export interface SessionBooking {
  id: string;
  status: string;
  startsAt: Date;
  durationMin: number;
  packageName: string | null;
  artistName: string;
  artistEmail: string;
}

function formatDuration(min: number): string {
  if (min <= 0) return "Pure delivery";
  if (min < 60) return `${String(min)} min`;
  const hours = Math.floor(min / 60);
  const rem = min % 60;
  if (rem === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(rem)}m`;
}

// Map raw status strings to a Badge variant + readable label. Unknown
// statuses fall back to neutral — avoids a hard crash if a new DB enum
// value lands before the UI catches up.
function statusPill(status: string): { variant: "active" | "warning" | "danger" | "neutral"; label: string } {
  switch (status) {
    case "confirmed":
      return { variant: "active", label: "Confirmed" };
    case "pending":
      return { variant: "warning", label: "Pending" };
    case "rejected":
    case "cancelled":
      return { variant: "danger", label: status === "rejected" ? "Rejected" : "Cancelled" };
    default:
      return { variant: "neutral", label: status };
  }
}

export function SessionsSubTab({
  projectId,
  booking,
}: {
  projectId: string;
  booking: SessionBooking | null;
}) {
  return (
    <section
      role="tabpanel"
      id="panel-sessions"
      aria-labelledby="tab-sessions"
      className="space-y-6"
    >
      {booking === null ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="No session on the calendar."
          description="Sessions show up here when the artist books through your public link, or when you schedule one from the Booking page."
          action={
            <Button asChild variant="secondary">
              <Link href="/dashboard/booking?tab=upcoming">Open booking</Link>
            </Button>
          }
          className="min-h-[40vh] justify-center"
        />
      ) : (
        <BookingCard projectId={projectId} booking={booking} />
      )}
    </section>
  );
}

function BookingCard({
  projectId,
  booking,
}: {
  projectId: string;
  booking: SessionBooking;
}) {
  // projectId is accepted so future Reschedule/Cancel wiring can scope
  // back to the project. Reference it in a void so the unused-param
  // lint doesn't fire on the current stub shape.
  void projectId;
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pill = statusPill(booking.status);
  // A session with durationMin <= 0 is a "pure delivery" product — no
  // actual slot. Suppress the date line in that case since `startsAt`
  // is just a now() placeholder.
  const hasSlot = booking.durationMin > 0;

  function onReschedule() {
    // TODO(sessions-reschedule): wire to a real rescheduling flow. No
    // booking.reschedule procedure exists today — the producer currently
    // has to cancel + rebook via the public link. Options for follow-up:
    //  1. Add booking.reschedule(id, startsAtIso) that re-runs the slot
    //     availability check from booking.publicRequest.
    //  2. Open a modal with the existing slot picker (apps/web/src/app/p/
    //     [slug]/book/) wired server-side to producer credentials.
    // For Task 7 we stub with a toast; the button is visible so the
    // surface matches the plan but the CTA makes its state honest.
    toast(
      "Rescheduling isn't wired yet - share your public link.",
      "info",
    );
  }

  function onCancel() {
    // TODO(sessions-cancel): wire to a real cancel-booking flow. The
    // existing booking.reject procedure only handles pending→rejected
    // transitions; confirmed bookings have no cancel-after-confirm
    // endpoint yet. Project-level cancel (project.cancel) tears down
    // the whole engagement including any Stripe subscription schedule,
    // which is heavier than what this button should do.
    //
    // For Task 7 we stub with a toast + router refresh so the surface
    // stays responsive. The full flow is tracked as a follow-up.
    startTransition(() => {
      toast(
        "Cancel-after-confirm isn't wired - use the 3-dot menu.",
        "info",
      );
      router.refresh();
    });
  }

  return (
    <article className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Linked session
          </p>
          <h3
            className="mt-1 font-display text-xl tracking-tight"
            style={{ fontWeight: 700 }}
          >
            {booking.packageName ?? "Session"}
          </h3>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            {booking.artistName}
            {" · "}
            <span className="font-mono text-xs">{booking.artistEmail}</span>
          </p>
        </div>
        <Badge variant={pill.variant} dot>
          {pill.label}
        </Badge>
      </header>

      <dl className="grid gap-3 border-t border-[rgb(var(--border-subtle))] pt-4 sm:grid-cols-2">
        {hasSlot ? (
          <div>
            <dt className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
              When
            </dt>
            <dd className="sk-num mt-1 text-sm text-[rgb(var(--fg-primary))]">
              {fmtDateTime(booking.startsAt)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Duration
          </dt>
          <dd className="sk-num mt-1 text-sm text-[rgb(var(--fg-primary))]">
            {formatDuration(booking.durationMin)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReschedule}
          disabled={pending || booking.status === "cancelled" || booking.status === "rejected"}
        >
          Reschedule
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onCancel}
          disabled={pending || booking.status === "cancelled" || booking.status === "rejected"}
        >
          Cancel
        </Button>
        <div className="ml-auto">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/booking?tab=upcoming">View all sessions</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5 1.75V4M11 1.75V4" />
    </svg>
  );
}
