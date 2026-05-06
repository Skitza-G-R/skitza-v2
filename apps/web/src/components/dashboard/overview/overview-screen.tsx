import Link from "next/link";

import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";

// Overview — locked design system (Phase 4, mobile-first).
//
// Mirrors `notes/producer-screens.jsx` ProducerHomeScreen, adapted
// for the existing producer.today + producer.me + booking.list data
// shapes. No new tRPC procedures (auth-fix in flight, hands off the
// server side).
//
// Section order locks the design's "most-actionable first" rule:
//   1. Hero — uppercase date eyebrow + "Name." with amber period +
//      one-line status summary derived from approvals/notes/today.
//   2. Pending Approvals — amber-bordered card. Conditional: only
//      renders when at least one booking has status="pending". Each
//      row links to /dashboard/calendar (where the producer's
//      ReviewModal will land in a follow-up; for now the row is a
//      Link to the calendar tab).
//   3. Today's Session — date column on the left, title + client on
//      the right, dark "Open client room" CTA. Conditional: only
//      renders when there is a session item in `today.items` whose
//      occurredAt is today's date.
//   4. Money split — Earned · this month + delta + Outstanding count.
//      Outstanding shows `unresolvedItems` (count of unpaid invoices
//      + open comments) until producer.today exposes a real
//      `outstandingCents` aggregation (deferred — handoff doc).
//   5. Activity — first 5 today.items with avatar/icon + text +
//      relative time + ping dot for unread.
//
// Server component — no `"use client"`. All interactivity is via
// <Link> navigation. Approval-Confirm/Reject flows live on the
// Calendar page (Phase 4 step 4).

export interface OverviewScreenProps {
  displayName: string | null;
  pulseStats: {
    thisMonthCents: number;
    currency: string;
    deltaPct: number | null;
    activeProjects: number;
    unresolvedItems: number;
    upcomingSessions7d: number;
  };
  pendingApprovals: Array<{
    id: string;
    /** artist_name is non-null in the schema. */
    artistName: string;
    artistEmail: string;
    startsAt: Date;
    durationMin: number;
    packageNameSnapshot: string | null;
    /** Maps to the schema's `notes` column (the artist's message). */
    message: string | null;
  }>;
  todaySession: {
    id: string;
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;
  } | null;
  activity: Array<{
    id: string;
    kind: "session" | "comment" | "invoice";
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;
    unread: boolean;
  }>;
  /** Server-provided "now" so date formatting stays stable across hydration. */
  now: Date;
}

export function OverviewScreen({
  displayName,
  pulseStats,
  pendingApprovals,
  todaySession,
  activity,
  now,
}: OverviewScreenProps) {
  const greetingName = (displayName ?? "").trim().split(/\s+/)[0] || "Hey";
  const dateEyebrow = formatDateEyebrow(now);
  const statusLine = buildStatusLine({
    approvalsCount: pendingApprovals.length,
    unresolvedItems: pulseStats.unresolvedItems,
    todaySession,
  });

  return (
    <div className="sk-page-enter flex flex-col gap-5 px-4 pt-6 pb-24 sm:gap-6 sm:px-6">
      {/* HERO */}
      <header>
        <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
          {dateEyebrow}
        </p>
        <h1 className="mt-1.5 font-display text-[34px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          {greetingName}
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p className="mt-2.5 text-[13.5px] leading-snug text-[rgb(var(--fg-muted))]">
          {statusLine}
        </p>
      </header>

      {/* PENDING APPROVALS — most urgent */}
      {pendingApprovals.length > 0 ? (
        <section
          aria-labelledby="approvals-heading"
          className="rounded-[var(--radius-lg)] border-[1.5px] border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--bg-elevated))] p-4 shadow-[0_4px_24px_rgb(var(--brand-primary)/0.08)]"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="approvals-heading"
              className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]"
            >
              Needs your approval
            </h2>
            <span className="pill pill-brand">
              <span className="ping-dot inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
              {pendingApprovals.length} new
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-[rgb(var(--border-subtle))]">
            {pendingApprovals.slice(0, 3).map((a) => {
              const name = a.artistName;
              return (
                <li key={a.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <ClientAvatar name={name} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-tight text-[rgb(var(--fg-default))]">
                        {name}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                        {a.packageNameSnapshot ?? "Session request"}
                      </p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-[rgb(var(--fg-muted))] tabular-nums">
                        {formatDateTime(a.startsAt)}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/calendar?booking=${a.id}`}
                    className="sk-press inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-3 py-2.5 text-xs font-bold text-[rgb(var(--brand-primary))]"
                  >
                    Review request
                    <ArrowRightIcon />
                  </Link>
                </li>
              );
            })}
          </ul>
          {pendingApprovals.length > 3 ? (
            <Link
              href="/dashboard/calendar"
              className="mt-3 inline-flex w-full items-center justify-center font-mono text-[10.5px] font-semibold uppercase tracking-widest text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--brand-primary))]"
            >
              See all {pendingApprovals.length} requests →
            </Link>
          ) : null}
        </section>
      ) : null}

      {/* TODAY'S SESSION */}
      {todaySession ? (
        <section
          aria-labelledby="today-session-heading"
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
        >
          <h2
            id="today-session-heading"
            className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
          >
            Today&rsquo;s session
          </h2>
          <div className="mb-3.5 flex items-start gap-3.5">
            <div className="w-14 shrink-0">
              <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--brand-primary))]">
                {formatDayLabel(todaySession.occurredAt)}
              </p>
              <p className="mt-0.5 font-display text-[36px] font-extrabold leading-none tracking-[-0.04em] text-[rgb(var(--fg-default))] tabular-nums">
                {formatHourMain(todaySession.occurredAt)}
                <span className="text-[18px] opacity-50">
                  :{formatMinuteSuffix(todaySession.occurredAt)}
                </span>
              </p>
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-base font-bold leading-tight text-[rgb(var(--fg-default))]">
                {todaySession.title}
              </p>
              <p className="mt-1.5 text-[13px] text-[rgb(var(--fg-muted))]">
                {todaySession.subtitle}
              </p>
            </div>
          </div>
          <Link
            href={todaySession.href}
            className="sk-press flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sidebar))] px-4 py-3 text-sm font-semibold text-[rgb(var(--fg-onsidebar))]"
          >
            Open client room
            <span aria-hidden className="opacity-55">
              →
            </span>
          </Link>
        </section>
      ) : null}

      {/* MONEY SPLIT */}
      <section
        aria-labelledby="money-heading"
        className="flex items-stretch gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5"
      >
        <h2 id="money-heading" className="sr-only">
          Studio finances
        </h2>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Earned · {monthShort(now)}
          </p>
          <p className="mt-1 font-mono text-[20px] font-extrabold leading-tight tracking-[-0.01em] text-[rgb(var(--fg-default))] tabular-nums">
            {formatMoney(pulseStats.thisMonthCents, pulseStats.currency)}
          </p>
          {pulseStats.deltaPct !== null && pulseStats.deltaPct !== 0 ? (
            <p
              className={[
                "mt-0.5 font-mono text-[10.5px] font-bold tabular-nums",
                pulseStats.deltaPct > 0
                  ? "text-[rgb(var(--fg-success))]"
                  : "text-[rgb(var(--fg-danger))]",
              ].join(" ")}
            >
              {pulseStats.deltaPct > 0 ? "↑" : "↓"} {Math.abs(pulseStats.deltaPct).toFixed(0)}%
            </p>
          ) : (
            <p className="mt-0.5 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]">—</p>
          )}
        </div>
        <div aria-hidden className="w-px self-stretch bg-[rgb(var(--border-subtle))]" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Needs follow-up
          </p>
          <p
            className={[
              "mt-1 font-mono text-[20px] font-extrabold leading-tight tracking-[-0.01em] tabular-nums",
              pulseStats.unresolvedItems > 0
                ? "text-[rgb(var(--brand-copper))]"
                : "text-[rgb(var(--fg-default))]",
            ].join(" ")}
          >
            {pulseStats.unresolvedItems}
          </p>
          <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
            {pulseStats.unresolvedItems === 1 ? "open item" : "open items"} ·{" "}
            <span className="tabular-nums">{pulseStats.activeProjects}</span>{" "}
            active
          </p>
        </div>
      </section>

      {/* ACTIVITY */}
      <section aria-labelledby="activity-heading">
        <h2
          id="activity-heading"
          className="mb-2.5 px-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]"
        >
          Activity
        </h2>
        {activity.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
            All quiet — nothing new since you last checked.
          </p>
        ) : (
          <ul className="flex flex-col">
            {activity.slice(0, 5).map((item, i, arr) => (
              <li
                key={item.id}
                className={[
                  "flex items-start gap-3 px-1 py-3",
                  i < arr.length - 1 ? "border-b border-[rgb(var(--border-subtle))]" : "",
                ].join(" ")}
              >
                <ActivityIcon kind={item.kind} title={item.title} />
                <Link
                  href={item.href}
                  className="-mx-1 min-w-0 flex-1 rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-[rgb(var(--bg-overlay))]"
                >
                  <p className="text-[13px] leading-snug text-[rgb(var(--fg-default))]">
                    {item.title}
                  </p>
                  <p className="mt-1 font-mono text-[10.5px] text-[rgb(var(--fg-muted))] tabular-nums">
                    {formatRelativeShort(item.occurredAt, now)} · {item.subtitle}
                  </p>
                </Link>
                {item.unread ? (
                  <span
                    aria-label="unread"
                    className="ping-dot mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// — Helpers —

function ClientAvatar({ name, size }: { name: string; size: number }) {
  const initials = producerInitials(name);
  const gradient = producerGradient(name);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-display font-extrabold text-white"
      style={{
        width: size,
        height: size,
        background: gradient,
        fontSize,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}

function ActivityIcon({
  kind,
  title,
}: {
  kind: "session" | "comment" | "invoice";
  title: string;
}) {
  // For client-named events we'd render the gradient avatar; today's
  // items don't carry a clientId, so we fall back to a kind-keyed
  // glyph in a brand-tinted square. Same 24px footprint as
  // ClientAvatar so the row rhythm stays consistent.
  return (
    <div
      aria-hidden
      title={title}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary))]"
    >
      {kind === "session" ? (
        <CalendarIcon />
      ) : kind === "comment" ? (
        <CommentIcon />
      ) : (
        <ReceiptIcon />
      )}
    </div>
  );
}

// — Pure formatters —

function formatDateEyebrow(d: Date): string {
  // "TUESDAY · MAY 5"
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const month = d.toLocaleDateString("en-US", { month: "long" }).toUpperCase();
  return `${weekday} · ${month} ${String(d.getDate())}`;
}

function buildStatusLine(args: {
  approvalsCount: number;
  unresolvedItems: number;
  todaySession: OverviewScreenProps["todaySession"];
}): string {
  const bits: string[] = [];
  if (args.approvalsCount > 0) {
    bits.push(
      `${String(args.approvalsCount)} request${args.approvalsCount > 1 ? "s" : ""} pending`,
    );
  }
  if (args.unresolvedItems > 0) {
    bits.push(
      `${String(args.unresolvedItems)} open note${args.unresolvedItems > 1 ? "s" : ""}`,
    );
  }
  if (args.todaySession) {
    bits.push(`session at ${formatTimeShort(args.todaySession.occurredAt)}`);
  }
  if (bits.length === 0) return "All quiet today.";
  return bits.slice(0, 2).join(" · ");
}

function formatDateTime(d: Date): string {
  return `${formatDayLabel(d)} · ${formatTimeShort(d)}`;
}

function formatDayLabel(d: Date): string {
  // "MAY 5" — uppercase, no comma.
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(d.getDate())}`;
}

function formatTimeShort(d: Date): string {
  // "4:00 PM"
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatHourMain(d: Date): string {
  const hours = d.getHours() % 12 || 12;
  return String(hours);
}

function formatMinuteSuffix(d: Date): string {
  return String(d.getMinutes()).padStart(2, "0");
}

function monthShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short" });
}

function formatRelativeShort(then: Date, now: Date): string {
  const diff = now.getTime() - then.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${String(d)}d ago`;
  return formatDayLabel(then);
}

// — Inline icons (no lucide-react dep) —

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 6h8" />
      <path d="m7 3 3 3-3 3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="3" width="11" height="11" rx="1.5" />
      <path d="M2.5 6.5h11" />
      <path d="M5 1.5v3" />
      <path d="M11 1.5v3" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4.5h11v7H6.5l-3 2.5v-2.5H2.5z" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 1.5v13l2-1 1.5 1 1.5-1 1.5 1 1.5-1 1 1v-13z" />
      <path d="M5.5 5.5h5" />
      <path d="M5.5 8h5" />
      <path d="M5.5 10.5h3" />
    </svg>
  );
}
