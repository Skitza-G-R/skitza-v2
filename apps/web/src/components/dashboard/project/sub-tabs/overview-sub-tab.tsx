"use client";

// Project Room → Overview tab.
//
// The Overview tab is the new primary landing view for a project (PRD
// §3.2 — May 2026 Project Room polish). It composes a single, scannable
// surface that answers "what's the state of this project right now?"
// without the producer having to switch tabs:
//
//   • 3-stat strip — Sessions linked / Tracks / Outstanding (money)
//   • Money snapshot — paid / outstanding / next charge (carried over
//     from the old Money tab; that tab is now folded in here)
//   • Key activity timeline — booking confirmed → first track uploaded
//     → comment thread → invoice paid (last 6 events)
//
// Pure read-only. Mutating controls (mark-paid / cancel / stage change)
// stay on ProjectHeader's 3-dot menu so they're available from every
// sub-tab. Nothing here calls a tRPC mutation.

import Link from "next/link";
import { useMemo } from "react";

import { Button } from "~/components/ui/button";
import { fmtDateTime, formatRelativeTime } from "~/lib/time/relative";

import {
  buildOverviewTimeline,
  computeLastActivity,
  type OverviewTimelineEvent,
} from "./overview-helpers";

// ─── Public prop shape ───────────────────────────────────────────────

export interface OverviewMoney {
  paidCents: number;
  outstandingCents: number;
  currency: string;
  nextChargeAt: Date | null;
}

export interface OverviewSession {
  id: string;
  status: string;
  startsAt: Date;
}

export interface OverviewTrack {
  id: string;
  title: string;
  createdAt: Date;
}

export interface OverviewVersion {
  id: string;
  trackId: string;
  label: string;
  uploadedAt: Date;
  approvedAt: Date | null;
}

export interface OverviewComment {
  id: string;
  versionId: string;
  authorName: string;
  body: string;
  fromProducer: boolean;
  createdAt: Date;
}

export interface OverviewProject {
  title: string;
  createdAt: Date;
  updatedAt: Date;
  finalPaid: boolean;
}

export function OverviewSubTab({
  project,
  money,
  session,
  tracks,
  versions,
  comments,
}: {
  project: OverviewProject;
  money: OverviewMoney;
  session: OverviewSession | null;
  tracks: OverviewTrack[];
  versions: OverviewVersion[];
  comments: OverviewComment[];
}) {
  // Last activity timestamp — the most recent of project.updatedAt,
  // any version uploaded, any comment posted. Used for the relative
  // "Last activity" copy in the stat strip. Pure helper lives in
  // ./overview-helpers so the data-shaping is unit-tested without
  // mounting React.
  const lastActivity = useMemo(
    () => computeLastActivity(project.updatedAt, versions, comments),
    [project.updatedAt, versions, comments],
  );

  return (
    <section
      role="tabpanel"
      id="panel-overview"
      aria-labelledby="tab-overview"
      className="space-y-8"
    >
      {/* 3-stat strip ----------------------------------------------- */}
      <div
        className="grid gap-4 sm:grid-cols-3"
        role="group"
        aria-label="Project at a glance"
      >
        <StatCard
          label="Tracks"
          value={String(tracks.length)}
          hint={
            tracks.length === 0
              ? "Upload your first track to get started."
              : `${String(versions.length)} version${versions.length === 1 ? "" : "s"} total`
          }
        />
        <StatCard
          label="Session"
          value={session ? statusLabel(session.status) : "—"}
          hint={
            session
              ? fmtDateTime(session.startsAt)
              : "No session linked yet."
          }
        />
        <StatCard
          label="Outstanding"
          value={
            money.outstandingCents > 0
              ? formatMoney(money.outstandingCents, money.currency)
              : "—"
          }
          hint={
            money.outstandingCents > 0
              ? "Awaiting payment"
              : project.finalPaid
                ? `Paid ${formatMoney(money.paidCents, money.currency)} total`
                : "Nothing due right now"
          }
          tone={money.outstandingCents > 0 ? "warn" : "neutral"}
        />
      </div>

      {/* Money + last-activity row --------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <MoneyCard money={money} />
        <MetaCard project={project} lastActivity={lastActivity} />
      </div>

      {/* Key activity timeline -------------------------------------- */}
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2
            className="font-display text-xl tracking-tight"
            style={{ fontWeight: 700 }}
          >
            Key activity
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="?tab=notes">Full activity log</Link>
          </Button>
        </div>
        <ActivityTimeline
          session={session}
          tracks={tracks}
          versions={versions}
          comments={comments}
          finalPaid={project.finalPaid}
          createdAt={project.createdAt}
        />
      </div>
    </section>
  );
}

// ─── Stat strip ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "warn";
}) {
  const valueColor =
    tone === "warn"
      ? "rgb(var(--fg-warning))"
      : "rgb(var(--fg-primary))";
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
      <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="sk-num mt-2 font-display text-3xl leading-none tracking-tight"
        style={{ fontWeight: 800, color: valueColor }}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-xs text-[rgb(var(--fg-secondary))]">{hint}</p>
      ) : null}
    </div>
  );
}

// ─── Money snapshot card ─────────────────────────────────────────────

function MoneyCard({ money }: { money: OverviewMoney }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
          Money
        </p>
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[rgb(var(--fg-muted))]">Paid</dt>
          <dd
            className="sk-num mt-1 font-display text-2xl leading-none"
            style={{ fontWeight: 800, color: "rgb(var(--brand-primary))" }}
          >
            {formatMoney(money.paidCents, money.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[rgb(var(--fg-muted))]">Outstanding</dt>
          <dd
            className="sk-num mt-1 font-display text-2xl leading-none"
            style={{
              fontWeight: 800,
              color:
                money.outstandingCents > 0
                  ? "rgb(var(--fg-warning))"
                  : "rgb(var(--fg-muted))",
            }}
          >
            {money.outstandingCents > 0
              ? formatMoney(money.outstandingCents, money.currency)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[rgb(var(--fg-muted))]">Next charge</dt>
          <dd
            className="sk-num mt-1 font-display text-2xl leading-none"
            style={{
              fontWeight: 800,
              color: money.nextChargeAt
                ? "rgb(var(--fg-primary))"
                : "rgb(var(--fg-muted))",
            }}
          >
            {money.nextChargeAt ? fmtShortDate(money.nextChargeAt) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ─── Project metadata (last activity / created) ──────────────────────

function MetaCard({
  project,
  lastActivity,
}: {
  project: OverviewProject;
  lastActivity: Date;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
      <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        Project
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-[rgb(var(--fg-muted))]">Last activity</dt>
          <dd className="mt-0.5 text-[rgb(var(--fg-primary))]">
            {formatRelativeTime(lastActivity)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[rgb(var(--fg-muted))]">Created</dt>
          <dd className="sk-num mt-0.5 font-mono text-xs text-[rgb(var(--fg-secondary))]">
            {fmtDateTime(project.createdAt)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ─── Activity timeline (last 6 events) ───────────────────────────────

function ActivityTimeline({
  session,
  tracks,
  versions,
  comments,
  finalPaid,
  createdAt,
}: {
  session: OverviewSession | null;
  tracks: OverviewTrack[];
  versions: OverviewVersion[];
  comments: OverviewComment[];
  finalPaid: boolean;
  createdAt: Date;
}) {
  const events: OverviewTimelineEvent[] = useMemo(
    () =>
      buildOverviewTimeline({
        createdAt,
        finalPaid,
        session: session ? { startsAt: session.startsAt, status: session.status } : null,
        tracks: tracks.map((t) => ({ createdAt: t.createdAt, title: t.title })),
        versions: versions.map((v) => ({
          uploadedAt: v.uploadedAt,
          trackId: v.trackId,
          label: v.label,
        })),
        comments: comments.map((c) => ({
          createdAt: c.createdAt,
          authorName: c.authorName,
          fromProducer: c.fromProducer,
          body: c.body,
        })),
      }),
    [session, tracks, versions, comments, finalPaid, createdAt],
  );

  if (events.length === 0) {
    return (
      <p className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-6 text-sm text-[rgb(var(--fg-secondary))]">
        Nothing to show yet. Upload a track or wait for the artist to
        respond — milestones land here as they happen.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {events.map((e, i) => (
        <li
          key={`${e.kind}-${String(e.at.valueOf())}-${String(i)}`}
          className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
        >
          <EventIcon kind={e.kind} />
          <div className="min-w-0 flex-1">
            <EventBody event={e} />
          </div>
          <p className="whitespace-nowrap font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
            {formatRelativeTime(e.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function EventIcon({ kind }: { kind: OverviewTimelineEvent["kind"] }) {
  const tone =
    kind === "paid"
      ? "rgb(var(--brand-primary))"
      : kind === "comment"
        ? "rgb(var(--brand-copper))"
        : "rgb(var(--fg-muted))";
  return (
    <span
      aria-hidden="true"
      className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: tone }}
    />
  );
}

function EventBody({ event }: { event: OverviewTimelineEvent }) {
  if (event.kind === "created") {
    return (
      <p className="text-sm text-[rgb(var(--fg-primary))]">
        <span className="font-semibold">Project created</span>
      </p>
    );
  }
  if (event.kind === "session") {
    return (
      <p className="text-sm text-[rgb(var(--fg-primary))]">
        <span className="font-semibold">Session {statusLabel(event.status).toLowerCase()}</span>
      </p>
    );
  }
  if (event.kind === "track") {
    return (
      <p className="text-sm text-[rgb(var(--fg-primary))]">
        <span className="font-semibold">Track added</span>{" "}
        <span className="text-[rgb(var(--fg-secondary))]">{event.trackTitle}</span>
      </p>
    );
  }
  if (event.kind === "version") {
    return (
      <p className="text-sm text-[rgb(var(--fg-primary))]">
        <span className="font-semibold">New version</span>{" "}
        <span className="font-mono text-xs text-[rgb(var(--brand-primary))]">
          {event.label}
        </span>
      </p>
    );
  }
  if (event.kind === "comment") {
    return (
      <div>
        <p className="text-sm text-[rgb(var(--fg-primary))]">
          <span className="font-semibold">{event.authorName}</span>{" "}
          <span className="text-[rgb(var(--fg-secondary))]">
            commented
          </span>
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-[rgb(var(--fg-secondary))]">
          {event.body}
        </p>
      </div>
    );
  }
  // paid
  return (
    <p className="text-sm text-[rgb(var(--fg-primary))]">
      <span className="font-semibold">Final delivered &amp; paid</span>
    </p>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function statusLabel(status: string): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "pending":
      return "Pending";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtShortDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d);
}
