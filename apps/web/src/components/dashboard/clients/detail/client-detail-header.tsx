import Link from "next/link";

import { formatMoney } from "~/lib/format/money";
import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

// Client detail header — the editorial top-of-page slab matching the
// founder's HTML mockup: brand-tinted gradient band, gradient avatar,
// "CLIENT · ACTIVE" eyebrow, display-font name (Fraunces, 4xl→6xl),
// subtitle row with email · since-date, single primary CTA (+ New
// project) and a 3-KPI strip below the name.
//
// Per direction (2026-05-06): "Message" CTA was removed entirely from
// both the header and the list-view cards — sending mail through us
// isn't part of v1. The header lands as a single primary CTA so the
// affordance reads cleanly without competing with a secondary action.
//
// KPI strip rules:
//   • PROJECTS — total count, "N active" sub-label only when active>0
//     (else "no active" reads as a dead state and the design uses just
//     the count). Activeness is a soft secondary signal here.
//   • OUTSTANDING — danger-tinted card when > 0, neutral "—" when 0.
//   • NEXT DEADLINE — earliest upcoming `nextSessionAt` across the
//     client's projects. Shows "—" when none — the project field is
//     a confirmed booking, so a missing value just means there's no
//     scheduled session, not that something's broken.

export type ClientDetailHeaderProject = {
  title: string;
  nextSessionAt: Date | null;
};

export interface ClientDetailHeaderProps {
  contact: {
    id: string;
    name: string;
    email: string;
    firstSeenAt: Date;
  };
  stats: {
    activeProjectCount: number;
    totalProjectCount: number;
    outstandingCents: number;
  };
  nextSession: { startsAt: Date; projectTitle: string } | null;
  currency: string;
  /** Pre-filled "+ New project" target — carries the client's email/name
   *  through to the new-project form. */
  newProjectHref: string;
}

export function ClientDetailHeader({
  contact,
  stats,
  nextSession,
  currency,
  newProjectHref,
}: ClientDetailHeaderProps) {
  const sinceLabel = formatSince(contact.firstSeenAt);
  const nextSessionLabel = formatNextSession(nextSession);

  return (
    <header className="flex flex-col gap-6">
      {/* Identity row — avatar + eyebrow + name + subtitle | CTA */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-4 sm:gap-5">
          <ClientAvatar name={contact.name} />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
              Client · Active
            </p>
            <h1 className="mt-1.5 break-words font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-tight text-[rgb(var(--fg-default))] sm:text-5xl lg:text-6xl">
              {contact.name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[rgb(var(--fg-muted))]">
              <a
                href={`mailto:${contact.email}`}
                className="truncate rounded-[var(--radius-sm)] underline decoration-dotted underline-offset-2 hover:text-[rgb(var(--fg-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                {contact.email}
              </a>
              {sinceLabel ? (
                <>
                  <span aria-hidden className="text-[rgb(var(--fg-muted))]">
                    ·
                  </span>
                  <span>Client since {sinceLabel}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:self-start">
          <Link
            href={newProjectHref}
            className="sk-pop inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--bg-base))] shadow-sm transition-transform hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
          >
            + New project
          </Link>
        </div>
      </div>

      {/* KPI strip — 3 cards, mobile-first stacked then row at sm+ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <KpiCard
          label="Projects"
          value={stats.totalProjectCount.toString()}
          sub={
            stats.activeProjectCount > 0
              ? `${stats.activeProjectCount.toString()} active`
              : "—"
          }
        />
        <KpiCard
          label="Outstanding"
          tone={stats.outstandingCents > 0 ? "danger" : "default"}
          value={
            stats.outstandingCents > 0
              ? formatMoney(stats.outstandingCents, currency)
              : "—"
          }
        />
        <KpiCard
          label="Next deadline"
          tone={nextSessionLabel.tone}
          value={nextSessionLabel.value}
          {...(nextSessionLabel.sub ? { sub: nextSessionLabel.sub } : {})}
        />
      </div>
    </header>
  );
}

// Three-state KPI card — neutral default, brand for "next deadline"
// when set, danger when outstanding > 0. Tinted backgrounds use the
// `/0.08` alpha pattern called out in CLAUDE.md (no nested var() with
// alpha — the parser fails silently).
function KpiCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "danger" | "brand";
}) {
  const palette =
    tone === "danger"
      ? {
          bg: "bg-[rgb(var(--fg-danger)/0.08)]",
          border: "border-[rgb(var(--fg-danger)/0.18)]",
          value: "rgb(var(--fg-danger))",
        }
      : tone === "brand"
        ? {
            bg: "bg-[rgb(var(--brand-primary)/0.08)]",
            border: "border-[rgb(var(--brand-primary)/0.18)]",
            value: "rgb(var(--brand-primary))",
          }
        : {
            bg: "bg-[rgb(var(--bg-elevated))]",
            border: "border-[rgb(var(--border-subtle))]",
            value: "rgb(var(--fg-default))",
          };
  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border px-4 py-3",
        palette.bg,
        palette.border,
      ].join(" ")}
    >
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="sk-num mt-1.5 font-mono text-2xl font-extrabold tabular-nums leading-tight"
        style={{ color: palette.value }}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

// 56px gradient avatar — same producerGradient + initials helpers used
// by the list-view cards so the visual identity stays consistent.
function ClientAvatar({ name }: { name: string }) {
  const initials = producerInitials(name);
  const gradient = producerGradient(name);
  return (
    <div
      aria-hidden
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-display text-lg font-extrabold text-white shadow-sm sm:h-[72px] sm:w-[72px] sm:text-xl"
      style={{
        background: gradient,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}

// firstSeenAt → "Nov 2025" (matches the design's "Client since Nov 2025").
// Uses Intl.DateTimeFormat with "short" month + numeric year — locale-
// dependent but English is the only locale on the producer surface.
function formatSince(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

// Compute the "Next deadline" KPI value + sub-label + tone from the
// earliest upcoming session across the client's projects. Returns
// neutral "—" when there's nothing scheduled, brand-amber for
// >2-day-out sessions, danger-red when within 24h or already passed
// (the producer should see "today" / "overdue" loud).
function formatNextSession(
  next: { startsAt: Date; projectTitle: string } | null,
): { value: string; sub?: string; tone: "default" | "danger" | "brand" } {
  if (!next) return { value: "—", tone: "default" };
  const ms = next.startsAt.getTime() - Date.now();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (ms < 0) {
    const overdueDays = Math.max(1, Math.abs(days));
    return {
      value: `${overdueDays.toString()}d late`,
      sub: next.projectTitle,
      tone: "danger",
    };
  }
  const isUrgent = days <= 1;
  const valueWord = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days.toString()}d`;
  return {
    value: valueWord,
    sub: next.projectTitle,
    tone: isUrgent ? "danger" : "brand",
  };
}
