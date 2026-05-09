"use client";

// Session list row per spec § 5.2.
//
// Grid: 54px (date column) | 1fr (body) | auto (actions).
// Cancelled / rejected rows render at 60% opacity. The Cancel action
// is hidden on already-cancelled / rejected rows. Action handlers are
// passed in so the parent panel owns modal state and `pendingId` etc.

import { KIND_COLORS, inferSessionKind } from "./session-kind";

export type RawBookingStatus =
  | "pending_approval"
  | "pending_payment"
  | "confirmed"
  | "rejected"
  | "cancelled";

export type SessionListItem = {
  id: string;
  artistName: string;
  artistEmail: string;
  startsAt: string; // ISO
  durationMin: number;
  packageName: string | null;
  status: RawBookingStatus;
};

type DerivedStatus =
  | "confirmed"
  | "pending"
  | "awaiting_payment"
  | "completed"
  | "rejected"
  | "cancelled";

export function SessionRow({
  session,
  now,
  onChangeTime,
  onSendReminder,
  onCancel,
}: {
  session: SessionListItem;
  now: Date;
  onChangeTime: (s: SessionListItem) => void;
  onSendReminder: (s: SessionListItem) => void;
  onCancel: (s: SessionListItem) => void;
}) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const derived = deriveStatus(session.status, end, now);
  const dimmed = derived === "cancelled" || derived === "rejected";
  const cancellable =
    derived !== "cancelled" &&
    derived !== "rejected" &&
    derived !== "completed";

  const kind = inferSessionKind(session.packageName);
  const kindToken = KIND_COLORS[kind];

  return (
    <div
      className="grid items-center gap-3.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 transition-colors hover:border-[rgb(var(--border-strong))]"
      style={{
        gridTemplateColumns: "54px minmax(0, 1fr) auto",
        opacity: dimmed ? 0.6 : 1,
      }}
    >
      <DateColumn date={start} kindToken={kindToken} />
      <BodyColumn session={session} start={start} end={end} status={derived} />
      <Actions
        cancellable={cancellable}
        onChangeTime={() => {
          onChangeTime(session);
        }}
        onSendReminder={() => {
          onSendReminder(session);
        }}
        onCancel={() => {
          onCancel(session);
        }}
      />
    </div>
  );
}

function DateColumn({ date, kindToken }: { date: Date; kindToken: string }) {
  const weekday = date
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();
  const day = String(date.getDate());
  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <div className="relative flex flex-col items-center justify-center pl-1.5 pr-1">
      <span
        aria-hidden
        className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-full"
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
      <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
        {time}
      </p>
    </div>
  );
}

function BodyColumn({
  session,
  start,
  end,
  status,
}: {
  session: SessionListItem;
  start: Date;
  end: Date;
  status: DerivedStatus;
}) {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
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
        <span
          className="truncate text-[rgb(var(--fg-default))]"
          style={{ fontWeight: 700 }}
        >
          {session.artistName}
        </span>
        <span className="font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">
          {fmt(start)} – {fmt(end)}
        </span>
      </div>
    </div>
  );
}

function Actions({
  cancellable,
  onChangeTime,
  onSendReminder,
  onCancel,
}: {
  cancellable: boolean;
  onChangeTime: () => void;
  onSendReminder: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <IconBtn label="Change time" onClick={onChangeTime}>
        <CalendarClockMini />
      </IconBtn>
      <IconBtn label="Send reminder" onClick={onSendReminder}>
        <BellMini />
      </IconBtn>
      {cancellable ? (
        <IconBtn label="Cancel session" tone="danger" onClick={onCancel}>
          <XMini />
        </IconBtn>
      ) : null}
    </div>
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
        "sk-press inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
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
  const map: Record<DerivedStatus, { label: string; cls: string }> = {
    confirmed: { label: "Confirmed", cls: "pill-success" },
    pending: { label: "Pending", cls: "pill-warning" },
    awaiting_payment: { label: "Awaiting payment", cls: "pill-warning" },
    completed: { label: "Completed", cls: "pill-neutral" },
    rejected: { label: "Rejected", cls: "pill-danger" },
    cancelled: { label: "Cancelled", cls: "pill-danger" },
  };
  const m = map[status];
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}

function deriveStatus(
  raw: RawBookingStatus,
  endsAt: Date,
  now: Date,
): DerivedStatus {
  if (raw === "rejected") return "rejected";
  if (raw === "cancelled") return "cancelled";
  if (raw === "pending_approval") return "pending";
  if (raw === "pending_payment") return "awaiting_payment";
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

function CalendarClockMini() {
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
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <circle cx="16" cy="16" r="3" />
      <line x1="16" y1="14" x2="16" y2="16" />
      <line x1="16" y1="16" x2="17.5" y2="17.5" />
    </svg>
  );
}

function BellMini() {
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
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
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
