"use client";

// Session list row per spec § 5.2.
//
// Grid: 54px (date column) | 1fr (body) | auto (actions).
// Cancelled / rejected rows render at 60% opacity. The Cancel action
// is hidden on already-cancelled / rejected rows. Action handlers are
// passed in so the parent panel owns modal state and `pendingId` etc.

import { calendarDateTimeParts, formatCalendarTime } from "./calendar-time";
import { ChangeRequestDecision } from "./change-request-decision";
import { KIND_COLORS, inferSessionKind } from "./session-kind";

export type RawBookingStatus =
  | "pending_approval"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "completed"
  | "no_show";

export type SessionListItem = {
  id: string;
  artistName: string;
  artistEmail: string;
  startsAt: string; // ISO
  durationMin: number;
  packageName: string | null;
  status: RawBookingStatus;
  billingTreatment?: "included" | "complimentary" | "billable_extra";
  artistRsvpStatus?: "needs_action" | "accepted" | "declined" | "tentative" | null;
  changeRequest?: {
    id: string;
    kind: "cancel" | "reschedule";
    proposedStartsAt: string | null;
    requestedAt: string;
  } | null;
};

type DerivedStatus = "confirmed" | "pending" | "completed" | "no_show" | "rejected" | "cancelled";

export function SessionRow({
  session,
  now,
  timeZone,
  onCancel,
  onReschedule,
}: {
  session: SessionListItem;
  now: Date;
  timeZone: string;
  onCancel: (s: SessionListItem) => void;
  onReschedule: (s: SessionListItem) => void;
}) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const derived = deriveStatus(session.status, end, now);
  const dimmed = derived === "cancelled" || derived === "rejected" || derived === "no_show";
  const cancellable =
    derived !== "cancelled" &&
    derived !== "rejected" &&
    derived !== "completed" &&
    derived !== "no_show";

  const kind = inferSessionKind(session.packageName);
  const kindToken = KIND_COLORS[kind];

  return (
    // <lg: two-row grid — date + body on top, the action buttons get
    // their own full-width row so the body isn't crushed on a 390px
    // screen. lg+: the spec's single-row 54px | 1fr | auto layout.
    <div
      className="grid grid-cols-[54px_minmax(0,1fr)] items-center gap-3.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 transition-colors hover:border-[rgb(var(--border-strong))] lg:grid-cols-[54px_minmax(0,1fr)_auto]"
      style={{
        opacity: dimmed ? 0.6 : 1,
      }}
    >
      <DateColumn date={start} kindToken={kindToken} timeZone={timeZone} />
      <BodyColumn session={session} start={start} end={end} status={derived} timeZone={timeZone} />
      {cancellable && !session.changeRequest ? (
        <Actions
          onReschedule={() => {
            onReschedule(session);
          }}
          onCancel={() => {
            onCancel(session);
          }}
        />
      ) : null}
      {session.changeRequest ? (
        <div className="col-span-2 lg:col-span-3">
          <ChangeRequestDecision session={session} timeZone={timeZone} />
        </div>
      ) : null}
    </div>
  );
}

function DateColumn({
  date,
  kindToken,
  timeZone,
}: {
  date: Date;
  kindToken: string;
  timeZone: string;
}) {
  const parts = calendarDateTimeParts(date, timeZone);
  const weekday = parts.weekday.toUpperCase();
  const day = String(parts.day);
  const time = formatCalendarTime(date, timeZone);
  return (
    <div className="relative flex flex-col items-center justify-center pr-1 pl-1.5">
      <span
        aria-hidden
        className="absolute top-1.5 left-0 h-[calc(100%-12px)] w-[3px] rounded-full"
        style={{ background: `rgb(var(${kindToken}))` }}
      />
      <p
        className="font-mono text-[9.5px] tracking-[0.08em] text-[rgb(var(--brand-primary-dark))]"
        style={{ fontWeight: 700 }}
      >
        {weekday}
      </p>
      <p
        className="font-display text-[22px] leading-none text-[rgb(var(--fg-default))]"
        style={{ fontWeight: 800, letterSpacing: "-0.03em" }}
      >
        {day}
      </p>
      <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">{time}</p>
    </div>
  );
}

function BodyColumn({
  session,
  start,
  end,
  status,
  timeZone,
}: {
  session: SessionListItem;
  start: Date;
  end: Date;
  status: DerivedStatus;
  timeZone: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <p
          className="truncate text-[13.5px] text-[rgb(var(--fg-default))]"
          style={{ fontWeight: 700 }}
        >
          {session.packageName ?? "Session"}
        </p>
        <StatusPill status={status} />
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-[rgb(var(--fg-muted))]">
        <Avatar name={session.artistName} email={session.artistEmail} />
        <span className="truncate text-[rgb(var(--fg-default))]" style={{ fontWeight: 700 }}>
          {session.artistName}
        </span>
        <span className="font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
          {formatCalendarTime(start, timeZone)} – {formatCalendarTime(end, timeZone)}
        </span>
      </div>
      {session.billingTreatment === "complimentary" ||
      session.billingTreatment === "billable_extra" ||
      session.artistRsvpStatus ? (
        <p className="mt-1 truncate text-[10px] text-[rgb(var(--fg-muted))]">
          {[
            session.billingTreatment === "complimentary" ? "Complimentary" : null,
            session.billingTreatment === "billable_extra" ? "Payment due" : null,
            session.artistRsvpStatus ? `Invite: ${rsvpLabel(session.artistRsvpStatus)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function Actions({ onCancel, onReschedule }: { onCancel: () => void; onReschedule: () => void }) {
  return (
    <div className="col-span-2 flex items-center justify-end gap-1 lg:col-span-1">
      <IconBtn label="Reschedule session" onClick={onReschedule}>
        <ClockMini />
      </IconBtn>
      <IconBtn label="Cancel session" tone="danger" onClick={onCancel}>
        <XMini />
      </IconBtn>
    </div>
  );
}

function rsvpLabel(status: NonNullable<SessionListItem["artistRsvpStatus"]>): string {
  if (status === "accepted") return "accepted";
  if (status === "declined") return "declined";
  if (status === "tentative") return "maybe";
  return "awaiting reply";
}

function ClockMini() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function IconBtn({
  label,
  children,
  onClick,
  tone = "muted",
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  tone?: "muted" | "danger";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={[
        // 44px tap target below lg; compact 30px square on desktop.
        "sk-press inline-flex h-11 w-11 items-center justify-center rounded-[7px] border transition-colors lg:h-[30px] lg:w-[30px]",
        "focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:outline-none",
        tone === "danger"
          ? "border-[rgb(var(--fg-danger)/0.25)] bg-transparent text-[rgb(var(--fg-danger))] hover:border-[rgb(var(--fg-danger)/0.45)] hover:bg-[rgb(var(--fg-danger)/0.08)]"
          : "border-[rgb(var(--border-subtle))] bg-transparent text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-default))]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: DerivedStatus }) {
  // Rejected uses an outline-only red treatment so it's visually
  // distinct from Cancelled (filled red). Same family — different
  // severity. Rejected = "I declined this incoming request before it
  // became a confirmed session"; Cancelled = "I cancelled an already-
  // confirmed session". Outline-vs-filled mirrors that hierarchy.
  if (status === "rejected") {
    return (
      <span
        className="inline-flex items-center rounded-[6px] border border-[rgb(var(--fg-danger)/0.4)] bg-transparent px-2 py-[2px] text-[10px] tracking-[0.08em] text-[rgb(var(--fg-danger))] uppercase"
        style={{ fontWeight: 700 }}
      >
        Rejected
      </span>
    );
  }
  const map: Record<Exclude<DerivedStatus, "rejected">, { label: string; cls: string }> = {
    confirmed: { label: "Confirmed", cls: "pill-success" },
    pending: { label: "Pending", cls: "pill-warning" },
    completed: { label: "Completed", cls: "pill-neutral" },
    no_show: { label: "No show", cls: "pill-danger" },
    cancelled: { label: "Cancelled", cls: "pill-danger" },
  };
  const m = map[status];
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}

function deriveStatus(raw: RawBookingStatus, endsAt: Date, now: Date): DerivedStatus {
  if (raw === "rejected") return "rejected";
  if (raw === "cancelled") return "cancelled";
  if (raw === "pending_approval") return "pending";
  if (raw === "completed") return "completed";
  if (raw === "no_show") return "no_show";
  // confirmed: completed if the session has already ended.
  if (endsAt.getTime() <= now.getTime()) return "completed";
  return "confirmed";
}

function Avatar({ name, email }: { name: string; email: string }) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const idx = hashCode(email) % AVATAR_GRADIENTS.length;
  const grad = AVATAR_GRADIENTS[idx] ?? AVATAR_GRADIENTS[0] ?? "";
  return (
    <span
      aria-hidden
      className="inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[8.5px] text-[rgb(var(--fg-inverse))]"
      style={{ background: grad, fontWeight: 800 }}
    >
      {initials || "?"}
    </span>
  );
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, rgb(var(--kind-mix)), rgb(var(--kind-songwriting)))",
  "linear-gradient(135deg, rgb(var(--kind-tracking)), rgb(var(--kind-master)))",
  "linear-gradient(135deg, rgb(var(--kind-intro)), rgb(var(--kind-mix)))",
  "linear-gradient(135deg, rgb(var(--brand-primary)), rgb(var(--brand-copper)))",
  "linear-gradient(135deg, rgb(var(--fg-default)), rgb(var(--brand-primary)))",
];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function XMini() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
