// Types + pure helpers for the artist sessions screens
// (Book section — S10 pick / S11 confirmed + My sessions / S12 cancel).
//
// Every helper here is pure: it takes its `now`/`today` as an argument and
// never reads the runtime clock or randomness inside, so the screens render
// identically on the server and the client (no hydration drift) and the unit
// tests stay deterministic. UTC-safe date parsing mirrors booking-client.tsx
// so SSR and CSR format the same string.
//
// Route pages map the tRPC Date values to ISO strings before crossing the
// server/client boundary. There is deliberately no placeholder data here:
// an empty response renders the real empty state.

import { coverGradient, formatShekels, swatchGradient } from "../purchase/purchase-data";

// Re-export the shared store primitives so the sessions screens import from
// one place (no duplicate gradient/format logic).
export { coverGradient, formatShekels, swatchGradient };

// ── Session-progress display ──────────────────────────────────────────
// How to show "sessions used of total" for an active booking. A short
// package reads as dots; a long one as a bar; an open-ended one as a count.

export type ProgressMode = "dots" | "bar" | "count";

export function progressMode(total: number | null): ProgressMode {
  if (total === null) return "count";
  if (total <= 6) return "dots";
  return "bar";
}

// One entry per session in the package; the first `used` are filled. Clamped
// defensively so a bad count never renders more (or negative) filled dots.
export function buildProgressDots(used: number, total: number): { filled: boolean }[] {
  const safeUsed = Math.min(Math.max(used, 0), total);
  return Array.from({ length: total }, (_v, i) => ({ filled: i < safeUsed }));
}

// ── Primary booking-action label (S10) ────────────────────────────────
// Gate 3 (session approval) is a producer toggle, default ON. When on, the
// slot is held pending approval ("Request"); when off it books instantly.

export function bookingActionLabel(gate3On: boolean): "Request this time" | "Book this time" {
  return gate3On ? "Request this time" : "Book this time";
}

// ── Artist-primary session date/time formatting ───────────────────
// Booking instants stay UTC internally. Artist surfaces render the Artist's
// configured IANA timezone first and add a concise Studio-time line only when
// the two configured timezones differ.

export function formatSessionDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

export function formatSessionTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });
}

function sessionTimeZoneOffset(iso: string, timeZone: string): string {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(iso))
    .find((part) => part.type === "timeZoneName")?.value;
  return offset ?? "GMT";
}

export function formatSessionTimeZoneLabel(iso: string, timeZone: string): string {
  return `${timeZone} · ${sessionTimeZoneOffset(iso, timeZone)}`;
}

function sessionLocalDateKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return iso.slice(0, 10);
  return `${year}-${month}-${day}`;
}

export function formatStudioTimeLine(
  iso: string,
  artistTimeZone: string,
  studioTimeZone: string,
): string | null {
  if (artistTimeZone === studioTimeZone) return null;
  const studioDate =
    sessionLocalDateKey(iso, artistTimeZone) === sessionLocalDateKey(iso, studioTimeZone)
      ? ""
      : `${formatSessionDate(iso, studioTimeZone)} · `;
  return `Studio time · ${studioDate}${formatSessionTime(iso, studioTimeZone)} ${sessionTimeZoneOffset(iso, studioTimeZone)}`;
}

export function groupSlotsByLocalDate<TSlot extends { startsAtISO: string }>(
  days: readonly { slots: readonly TSlot[] }[],
  timeZone: string,
): Array<{ date: string; slots: TSlot[] }> {
  const grouped = new Map<string, TSlot[]>();
  for (const day of days) {
    for (const slot of day.slots) {
      const date = sessionLocalDateKey(slot.startsAtISO, timeZone);
      const slots = grouped.get(date) ?? [];
      slots.push(slot);
      grouped.set(date, slots);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, slots]) => ({
      date,
      slots: slots.sort(
        (left, right) =>
          new Date(left.startsAtISO).getTime() - new Date(right.startsAtISO).getTime(),
      ),
    }));
}

// ── Domain types ──────────────────────────────────────────────────────

export type SessionStatus =
  | "pending_payment"
  | "pending_approval"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "completed"
  | "no_show";

export type SessionOutcome =
  | "reserved"
  | "completed"
  | "cancelled_on_time"
  | "cancelled_by_producer"
  | "cancelled_late"
  | "no_show"
  | null;

export type ArtistSessionDisplayStatus =
  | "held"
  | "confirmed"
  | "declined"
  | "completed"
  | "cancelled";

export function artistSessionDisplay(input: {
  status: SessionStatus;
  outcome: SessionOutcome;
  heldExpiryReason?: "approval_timeout" | null;
}): {
  status: ArtistSessionDisplayStatus;
  label: "Held" | "Confirmed" | "Declined" | "Completed" | "Cancelled";
  secondary: string | null;
} {
  if (input.status === "pending_payment" || input.status === "pending_approval") {
    return {
      status: "held",
      label: "Held",
      secondary:
        input.status === "pending_payment"
          ? "Waiting for payment"
          : "Waiting for producer approval",
    };
  }
  if (input.status === "confirmed") {
    return { status: "confirmed", label: "Confirmed", secondary: null };
  }
  if (input.status === "rejected") {
    return { status: "declined", label: "Declined", secondary: null };
  }
  if (input.status === "no_show" || input.outcome === "no_show") {
    return { status: "completed", label: "Completed", secondary: "Marked no-show" };
  }
  if (input.status === "completed") {
    return { status: "completed", label: "Completed", secondary: null };
  }
  return {
    status: "cancelled",
    label: "Cancelled",
    secondary:
      input.heldExpiryReason === "approval_timeout"
        ? "The studio did not confirm this request in time."
        : input.outcome === "cancelled_by_producer"
          ? "Cancelled by producer"
          : input.outcome === "cancelled_late"
            ? "Cancelled after the change window"
            : null,
  };
}

export type SessionPolicy = {
  cancellationPolicyHours: number;
  cancellationDeadlineISO: string;
  isOnTime: boolean;
  canCancel: boolean;
  canReschedule: boolean;
};

export type SessionListItem = {
  id: string;
  producerId: string;
  producerName: string;
  producerSlug: string;
  artistTimezone: string;
  producerTimezone: string;
  projectId: string;
  projectTitle: string;
  purchaseId: string;
  sessionAllowanceId: string;
  startsAtISO: string;
  durationMin: number;
  packageName: string;
  locationType: string;
  status: SessionStatus;
  outcome: SessionOutcome;
  billingTreatment?: "included" | "complimentary" | "billable_extra";
  artistRsvpStatus?: "needs_action" | "accepted" | "declined" | "tentative" | null;
  artistRsvpRespondedAtISO?: string | null;
  changeRequest?: {
    id: string;
    kind: "cancel" | "reschedule";
    status: "pending";
    proposedStartsAtISO: string | null;
    requestedAtISO: string;
  } | null;
  rescheduledFromBookingId: string | null;
  heldExpiryReason: "approval_timeout" | null;
  policy: SessionPolicy;
};

export type AllowanceSummary = {
  purchaseId: string;
  sessionAllowanceId: string;
  producerId: string;
  producerName: string;
  projectId: string;
  projectTitle: string;
  packageName: string;
  kind: "fixed" | "unlimited";
  sessionLimit: number | null;
  sessionsUsed: number;
  sessionsRemaining: number | null;
  durationMin: number;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  closedAtISO: string | null;
  canBook: boolean;
  bookingBlockedReason:
    | "studio_closed"
    | "purchase_waiting_for_payment"
    | "purchase_canceled"
    | "project_waiting_for_payment"
    | "project_paused"
    | "project_completed"
    | "project_canceled"
    | "allowance_closed"
    | "allowance_exhausted"
    | null;
};

export type SessionDetail = SessionListItem & {
  bufferMinutes: number;
  minLeadHours: number;
  autoConfirm: boolean;
};

export function allowanceCanBook(allowance: AllowanceSummary): boolean {
  return (
    allowance.canBook &&
    allowance.closedAtISO === null &&
    (allowance.kind === "unlimited" || (allowance.sessionsRemaining ?? 0) > 0)
  );
}

export function allowanceUnavailableMessage(allowance: AllowanceSummary): string | null {
  if (allowanceCanBook(allowance)) return null;
  switch (allowance.bookingBlockedReason) {
    case "studio_closed":
      return "This studio is closed. New sessions are not available.";
    case "purchase_waiting_for_payment":
      return "Booking opens after the complete required first installment is paid.";
    case "purchase_canceled":
      return "This purchase is canceled. New sessions require a new purchase.";
    case "project_waiting_for_payment":
      return "Booking opens when this project becomes active.";
    case "project_paused":
      return "New booking is paused. Listening and comments stay available.";
    case "project_completed":
    case "project_canceled":
      return "This project is closed. New sessions require a new purchase.";
    case "allowance_closed":
      return "This allowance is permanently closed. New sessions require a new purchase.";
    case "allowance_exhausted":
      return "All included sessions have been used. New sessions require a new purchase.";
    default:
      return "New booking is not available for this allowance.";
  }
}

export function allowanceBookHref(allowance: AllowanceSummary): string {
  const params = new URLSearchParams({
    studio: allowance.producerId,
    project: allowance.projectId,
    allowance: allowance.sessionAllowanceId,
  });
  return `/artist/book?${params.toString()}`;
}

export function locationLabel(locationType: string): string {
  switch (locationType) {
    case "remote":
      return "Remote";
    case "client_space":
      return "Your space";
    case "studio":
      return "Producer studio";
    default:
      return locationType.replaceAll("_", " ");
  }
}
