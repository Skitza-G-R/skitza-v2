import Link from "next/link";

import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";
import type { Stage } from "~/lib/projects/stages";
import { STAGE_LABEL } from "~/lib/projects/stages";
import { buildJoinUrl } from "~/lib/share/public-url";
import { formatRelativeTime } from "~/lib/time/relative";

import { PublicLinkStrip } from "./public-link-strip";

// Overview — locked design system (Phase 4 → Overview Polish).
//
// History:
//   - Phase 4 first iteration: hero "Name." + amber period, approvals
//     card, today's session, money split, activity feed.
//   - Overview Polish: brought the layout in line with the locked
//     design (default OverviewTab variant) — greeting, PublicLinkStrip,
//     approvals, today's session, two-column urgent + recent, full-
//     width financial pulse, activity feed.
//   - Project-level urgent (THIS revision): Urgent card switched from
//     event-stream filtering (today.items.filter(kind !== 'session'))
//     to a project-shaped feed via `producer.overview.urgent`. Each
//     row is one project with a status pill (OVERDUE / DEPOSIT DUE /
//     STUCK) and links to the project room — collapsing the
//     "two-unpaid-invoices on one project = one row" duplication and
//     making "stuck in production" surfaceable without a synthetic
//     comment row.
//
// Notes:
//   - Server component (no `"use client"`). The PublicLinkStrip is
//     the only piece needing client interactivity (clipboard) and is
//     scoped to its own file.
//   - Urgent rows are pre-classified server-side; the component is
//     dumb — it only maps the urgency token to a colored pill.
//   - Sparkline reads `pulseStats.sparkline` (a fixed 30-bucket array
//     the server already zero-fills). When all values are 0 we hide
//     the SVG entirely so a flat baseline doesn't read as a chart.

export interface OverviewScreenProps {
  displayName: string | null;
  /** Producer's chosen public slug (null until they pick one). */
  slug: string | null;
  pulseStats: {
    thisMonthCents: number;
    currency: string;
    deltaPct: number | null;
    activeProjects: number;
    unresolvedItems: number;
    upcomingSessions7d: number;
    /** 30-bucket array — oldest at index 0, today at index 29. */
    sparkline: number[];
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
  /**
   * Project-level urgent rows from `producer.overview.urgent`. Each
   * item is one project with a pre-classified urgency token; the
   * component just maps the token to a pill color.
   */
  urgentProjects: Array<{
    id: string;
    title: string;
    clientName: string;
    gradient: string;
    stage: Stage;
    urgency: "overdue" | "deposit_due" | "stuck";
  }>;
  recentUploads: Array<{
    versionId: string;
    trackId: string;
    title: string;
    versionLabel: string;
    uploadedAt: Date;
    durationMs: number | null;
    projectId: string;
    projectClientName: string;
  }>;
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
  slug,
  pulseStats,
  pendingApprovals,
  todaySession,
  urgentProjects,
  recentUploads,
  activity,
  now,
}: OverviewScreenProps) {
  const greetingName = (displayName ?? "").trim().split(/\s+/)[0] || "there";
  const greetingSalutation = greetingFor(now);
  // Urgent rows are pre-classified + capped server-side; the component
  // just renders them. Show the empty state when the producer has live
  // projects but none are urgent — see UrgentCard's branch below.
  const recentTop = recentUploads.slice(0, 3);
  // Day-1 / completely-fresh detector. When every Overview signal is
  // empty, the standard 4-card layout collapses into a single
  // FirstWeekPanel so the producer doesn't see three stacked "all
  // clear" messages in a row (see audit 2026-05-14). Any positive
  // signal — even a single pending approval — exits this mode.
  const isFirstWeek = isFirstWeekEmptyState({
    thisMonthCents: pulseStats.thisMonthCents,
    activityCount: activity.length,
    urgentCount: urgentProjects.length,
    hasTodaySession: todaySession !== null,
    pendingApprovalsCount: pendingApprovals.length,
  });
  // Collapse the 2-up Urgent+Recent grid when Urgent has nothing but
  // Recent has uploads — see the JSX block below for the rationale.
  const useFullWidthRecent =
    urgentProjects.length === 0 && recentTop.length > 0;

  return (
    // Mobile: single vertical stack (gap-5). Desktop (lg+): same
    // vertical rhythm but with a wider max-width and per-section
    // grids (the urgent + recent pair becomes 2-up).
    <div className="sk-page-enter mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-4 pt-6 pb-24 sm:gap-6 sm:px-6 lg:px-8 lg:pt-10">
      {/* GREETING — the redundant top-right "May 14, 2026" date chip
          was removed 2026-05-14 (audit): it duplicated info already
          visible in the producer's OS clock and competed with the
          "Accepting Sessions" pill for visual weight. */}
      <header className="reveal-up min-w-0">
        <span className="pill pill-success inline-flex items-center gap-1.5">
          <PingDot color="rgb(var(--fg-success))" />
          Accepting Sessions
        </span>
        <h1 className="font-syne mt-3 text-[clamp(28px,4vw,44px)] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--fg-default))]">
          {greetingSalutation}, {greetingName}.
        </h1>
        <p className="mt-1 text-sm text-[rgb(var(--fg-muted))]">
          Here is the pulse of your studio today.
        </p>
      </header>

      {/* PUBLIC LINK HERO — only when slug is set. The Day-1 empty
          branch upstream owns the "set your slug" path. */}
      {slug ? (
        <div className="reveal-up reveal-up-delay-1">
          <PublicLinkStrip slug={slug} />
        </div>
      ) : null}

      {isFirstWeek ? (
        <FirstWeekPanel slug={slug} />
      ) : (
        <>
      {/* PENDING APPROVALS — most urgent, when present */}
      {pendingApprovals.length > 0 ? (
        <section
          aria-labelledby="approvals-heading"
          className="reveal-up reveal-up-delay-1 rounded-[var(--radius-lg)] border-[1.5px] border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--bg-elevated))] p-4 shadow-[0_4px_24px_rgb(var(--brand-primary)/0.08)]"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="approvals-heading"
              className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]"
            >
              Needs your approval
            </h2>
            <span className="pill pill-brand">
              <PingDot color="rgb(var(--brand-primary))" size={6} />
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

      {/* TWO-COLUMN: Urgent + Recent uploads. Urgent renders alone
          when populated (or when there's no recent activity either —
          the green-check empty state still belongs on screen as a
          "you have projects, nothing urgent" signal). But when Urgent
          is empty AND Recent has items, we drop Urgent and let Recent
          take the full row — pairing a stubby ~80px "Nothing urgent"
          card with a tall ~280px Recent Uploads card just dedicates
          50% of the viewport to a green-check pill. */}
      {useFullWidthRecent ? (
        <div className="reveal-up reveal-up-delay-2">
          <RecentUploadsCard uploads={recentTop} now={now} />
        </div>
      ) : (
        <div className="reveal-up reveal-up-delay-2 grid gap-4 sm:gap-5 lg:grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
          <UrgentCard projects={urgentProjects} />
          {recentTop.length > 0 ? <RecentUploadsCard uploads={recentTop} now={now} /> : null}
        </div>
      )}

      {/* FINANCIAL PULSE — full-width, 3 columns */}
      <FinancialPulseCard
        pulseStats={pulseStats}
        now={now}
      />

      {/* ACTIVITY FEED — supporting context */}
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
          <ul className="flex flex-col rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
            {activity.slice(0, 5).map((item, i, arr) => (
              <li
                key={item.id}
                className={[
                  "flex items-start gap-3 px-3 py-3",
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
        </>
      )}
    </div>
  );
}

// — FirstWeekPanel — Day-1 empty-state hero —
//
// Replaces the standard 4-card layout when every Overview signal is
// empty (no income, no activity, no urgent project, no session today,
// no pending approval). Designed to give a freshly-onboarded producer
// one warm, opinionated next-step panel instead of three stacked
// "all clear" messages.
//
// The three CTAs are each a real one-click action (not "go to a page
// where you might do the thing"):
//   01 Share — wa.me deep link with the producer's /join URL
//      pre-filled. Opens WhatsApp Web on desktop, the app on mobile;
//      lets the producer pick the recipient and edit the message
//      before sending. (The PublicLinkStrip above already handles
//      basic clipboard copy — this CTA's job is the next channel.)
//   02 Preview — opens /join/<slug> in a NEW TAB so the producer can
//      verify what artists see without losing their dashboard.
//   03 Polish — sends to /dashboard/portfolio: portfolio tracks are
//      the highest-impact conversion lever (artists need to hear the
//      work to book), and this CTA must not duplicate share or profile.

function FirstWeekPanel({ slug }: { slug: string | null }) {
  // Pre-filled WhatsApp message. Editable by the producer before
  // sending. Only generated when we actually have a slug — without
  // one there's nothing to share, so the CTA falls back to the
  // profile editor instead.
  const whatsappShareUrl = slug
    ? `https://wa.me/?text=${encodeURIComponent(`Listen + book a session with me on Skitza: ${buildJoinUrl(slug)}`)}`
    : null;

  return (
    <section
      aria-labelledby="first-week-heading"
      className="reveal-up reveal-up-delay-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 sm:p-8"
    >
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]">
        Your first week
      </p>
      <h2
        id="first-week-heading"
        className="font-syne mt-2 text-[clamp(20px,2.6vw,26px)] font-extrabold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]"
      >
        A quiet day &mdash; let&rsquo;s get the first artist on the books.
      </h2>
      <p className="mt-2 max-w-prose text-sm text-[rgb(var(--fg-muted))]">
        Once you share your public link, artists can listen to your work, book
        sessions, and pay you. Here&rsquo;s the fastest path to your first
        session.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <FirstWeekActionTile
          step="01"
          title="Share on WhatsApp"
          subtitle="Open WhatsApp with your link already filled in. Pick a contact and hit send."
          cta={whatsappShareUrl ? "Open WhatsApp" : "Set a public link first"}
          href={whatsappShareUrl ?? "/dashboard/profile"}
          external={whatsappShareUrl !== null}
          newTab
          accent
        />
        <FirstWeekActionTile
          step="02"
          title="See what artists see"
          subtitle="Open your public join page in a new tab. Make sure it looks the way you want."
          cta={slug ? "Preview /join" : "Set a public link first"}
          href={slug ? `/join/${slug}` : `/dashboard/profile`}
          newTab={slug !== null}
        />
        <FirstWeekActionTile
          step="03"
          title="Add a portfolio track"
          subtitle="Artists need to hear your work to book. Upload one or two of your best."
          cta="Upload tracks"
          href="/dashboard/portfolio"
        />
      </div>
    </section>
  );
}

// FirstWeekActionTile renders either an internal Next.js Link or a
// plain anchor (for external URLs like wa.me). Both support new-tab.
//
// `external` — when true, render <a> instead of <Link>. Required for
//   wa.me/ and any other non-Next-routed URL; using <Link> would have
//   Next intercept the click and try to client-route to an off-site URL.
// `newTab` — adds target="_blank" + the standard noopener/noreferrer
//   rel pair. Use for previewing /join (don't lose dashboard position)
//   and for any external link.

function FirstWeekActionTile({
  step,
  title,
  subtitle,
  cta,
  href,
  accent = false,
  external = false,
  newTab = false,
}: {
  step: string;
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  accent?: boolean;
  external?: boolean;
  newTab?: boolean;
}) {
  const className = [
    "sk-press group flex flex-col gap-2 rounded-[var(--radius-md)] border p-4",
    accent
      ? "border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--brand-primary)/0.06)]"
      : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]",
  ].join(" ");

  const inner = (
    <>
      <span
        className={[
          "font-mono text-[10px] font-bold uppercase tracking-widest",
          accent ? "text-[rgb(var(--brand-primary))]" : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        {step}
      </span>
      <span className="text-sm font-bold leading-tight text-[rgb(var(--fg-default))]">
        {title}
      </span>
      <span className="text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
        {subtitle}
      </span>
      <span
        className={[
          "mt-1 inline-flex items-center gap-1 font-mono text-[10.5px] font-bold uppercase tracking-widest",
          accent
            ? "text-[rgb(var(--brand-primary))]"
            : "text-[rgb(var(--fg-secondary))]",
        ].join(" ")}
      >
        {cta} <ArrowRightIcon />
      </span>
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        className={className}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : undefined}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={href}
      className={className}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
    >
      {inner}
    </Link>
  );
}

// — Subcomponents —

function UrgentCard({
  projects,
}: {
  projects: OverviewScreenProps["urgentProjects"];
}) {
  return (
    <section
      aria-labelledby="urgent-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="urgent-heading"
          className="inline-flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-default))]"
        >
          <AlertCircleIcon />
          Urgent projects
        </h2>
        <Link
          href="/dashboard/clients-projects"
          className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--brand-primary))]"
        >
          View all →
        </Link>
      </div>
      {projects.length === 0 ? (
        <UrgentEmpty />
      ) : (
        <ul className="flex flex-col gap-1">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/dashboard/clients-projects/${p.id}`}
                className="sk-row flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <ProjectGradientBadge gradient={p.gradient} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                        {p.title}
                      </span>
                      <UrgencyPill urgency={p.urgency} />
                    </div>
                    <div className="truncate text-xs text-[rgb(var(--fg-muted))]">
                      {p.clientName || "—"}
                      <span className="mx-1.5 opacity-40">·</span>
                      {STAGE_LABEL[p.stage]}
                    </div>
                  </div>
                </div>
                <ChevronRightIcon />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectGradientBadge({ gradient }: { gradient: string }) {
  return (
    <div
      aria-hidden
      className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)]"
      style={{ background: gradient }}
    />
  );
}

/**
 * Empty-state row for the Urgent card. Renders inside the card, mirrors
 * the design's "you're on top of everything" line + green check icon.
 */
function UrgentEmpty() {
  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] px-3 py-4 text-[12.5px] text-[rgb(var(--fg-muted))]">
      <CheckIcon />
      Nothing urgent. You&rsquo;re on top of everything.
    </div>
  );
}

/**
 * Color-coded urgency pill. Maps the three classifier outputs to the
 * design's red ("OVERDUE") / amber ("DEPOSIT DUE") / muted ("STUCK")
 * tones. All colors come from the design-token palette — no hex
 * literals — so theme + RTL stay consistent.
 */
function UrgencyPill({
  urgency,
}: {
  urgency: "overdue" | "deposit_due" | "stuck";
}) {
  if (urgency === "overdue") {
    return (
      <span className="inline-flex items-center rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-danger))]">
        Overdue
      </span>
    );
  }
  if (urgency === "deposit_due") {
    return (
      <span className="inline-flex items-center rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.3)] bg-[rgb(var(--fg-warning)/0.10)] px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-warning))]">
        Deposit due
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-overlay))] px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
      Stuck
    </span>
  );
}

function RecentUploadsCard({
  uploads,
  now,
}: {
  uploads: OverviewScreenProps["recentUploads"];
  now: Date;
}) {
  return (
    <section
      aria-labelledby="recent-uploads-heading"
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="recent-uploads-heading"
          className="inline-flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-default))]"
        >
          <ActivityGlyph />
          Recent uploads
        </h2>
        <Link
          href="/dashboard/music"
          className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--brand-primary))]"
        >
          Library →
        </Link>
      </div>
      <ul className="flex flex-col gap-0.5">
        {uploads.map((u) => (
          <li key={u.versionId}>
            <Link
              href={`/dashboard/clients-projects/${u.projectId}?tab=music&versionId=${u.versionId}`}
              className="sk-row flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5"
            >
              <PlayCircleIcon />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                  {u.title}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
                  {u.projectClientName || "—"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
                  Uploaded
                </span>
                <span className="text-[12px] font-bold text-[rgb(var(--fg-default))]">
                  {formatRelativeTime(u.uploadedAt, now)}
                </span>
              </div>
              <div className="ml-3 flex shrink-0 flex-col items-end gap-0.5">
                <span className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
                  Duration
                </span>
                <span className="font-mono text-[12px] font-bold tabular-nums text-[rgb(var(--fg-default))]">
                  {formatDuration(u.durationMs)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FinancialPulseCard({
  pulseStats,
  now,
}: {
  pulseStats: OverviewScreenProps["pulseStats"];
  now: Date;
}) {
  const sparkPath = buildSparkPath(pulseStats.sparkline);
  return (
    <section
      aria-labelledby="finance-heading"
      className="reveal-up reveal-up-delay-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
    >
      <header className="flex items-center justify-between px-4 pt-4 pb-2 sm:px-5 sm:pt-5">
        <h2
          id="finance-heading"
          className="inline-flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-default))]"
        >
          <DollarIcon />
          Financial pulse
        </h2>
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          {monthShort(now)}
        </span>
      </header>
      <div className="flex flex-wrap items-stretch">
        {/* Earned this month */}
        <div className="relative min-w-[200px] flex-1 border-r border-[rgb(var(--border-subtle)/0.7)] px-4 py-3 sm:px-5">
          <div className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Earned this month
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <div className="font-display text-[32px] font-extrabold tracking-[-0.02em] tabular-nums text-[rgb(var(--fg-default))]">
              {formatMoney(pulseStats.thisMonthCents, pulseStats.currency)}
            </div>
            {pulseStats.deltaPct !== null && pulseStats.deltaPct !== 0 ? (
              <span
                className={[
                  "inline-flex items-center gap-0.5 rounded-[var(--radius-lg)] border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                  pulseStats.deltaPct > 0
                    ? "border-[rgb(var(--fg-success)/0.22)] bg-[rgb(var(--fg-success)/0.10)] text-[rgb(var(--fg-success))]"
                    : "border-[rgb(var(--fg-danger)/0.22)] bg-[rgb(var(--fg-danger)/0.08)] text-[rgb(var(--fg-danger))]",
                ].join(" ")}
              >
                {pulseStats.deltaPct > 0 ? "↑" : "↓"} {Math.abs(pulseStats.deltaPct).toFixed(0)}%
              </span>
            ) : null}
          </div>
          {sparkPath ? (
            <svg
              aria-hidden
              width="100"
              height="22"
              viewBox="0 0 100 22"
              className="absolute right-3 bottom-3 opacity-50"
              preserveAspectRatio="none"
            >
              <path
                d={sparkPath}
                fill="none"
                stroke="rgb(var(--fg-success))"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </div>
        {/* Outstanding */}
        <div className="min-w-[200px] flex-1 border-r border-[rgb(var(--border-subtle)/0.7)] px-4 py-3 sm:px-5">
          <div className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Outstanding
          </div>
          <div className="mt-2 font-display text-[32px] font-extrabold tracking-[-0.02em] tabular-nums text-[rgb(var(--fg-default))]">
            {pulseStats.unresolvedItems}
          </div>
          <div className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
            {pulseStats.unresolvedItems === 1 ? "open item" : "open items"} ·{" "}
            <span className="tabular-nums">{pulseStats.activeProjects}</span>{" "}
            active
          </div>
        </div>
        {/* Needs follow-up */}
        <div className="min-w-[220px] flex-1 px-4 py-3 sm:px-5">
          <div className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Needs follow-up
          </div>
          {pulseStats.unresolvedItems > 0 ? (
            <Link
              href="/dashboard/clients-projects?filter=unresolved"
              className="sk-row mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.2)] bg-[rgb(var(--fg-danger)/0.06)] px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <PingDot color="rgb(var(--fg-danger))" size={10} />
                <div>
                  <div className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
                    {pulseStats.unresolvedItems === 1
                      ? "1 unresolved item"
                      : `${String(pulseStats.unresolvedItems)} unresolved items`}
                  </div>
                  <div className="text-[11px] text-[rgb(var(--fg-danger))]">
                    Open invoices &amp; comments
                  </div>
                </div>
              </div>
              <ArrowRightIcon />
            </Link>
          ) : (
            <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] px-3 py-3 text-[12px] text-[rgb(var(--fg-muted))]">
              <CheckIcon />
              All clear — nothing waiting.
            </div>
          )}
        </div>
      </div>
    </section>
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

function PingDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, position: "relative", display: "inline-block" }}
    >
      <span
        className="ping-dot"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          opacity: 0.5,
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
        }}
      />
    </span>
  );
}

// — Pure formatters —

function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDateTime(d: Date): string {
  return `${formatDayLabel(d)} · ${formatTimeShort(d)}`;
}

function formatDayLabel(d: Date): string {
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(d.getDate())}`;
}

function formatTimeShort(d: Date): string {
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
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
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

/** Format duration as `m:ss` (mm:ss when ≥ 10m). Returns "—" for null. */
function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min)}:${String(sec).padStart(2, "0")}`;
}

/**
 * Detect the "completely fresh producer" state — every Overview signal
 * empty. Used to swap the standard 4-card layout for a single
 * FirstWeekPanel so a day-1 producer doesn't see three stacked "all
 * clear" messages in a row.
 *
 * Any positive signal (a single pending approval, ₪1 earned, a refund
 * showing as negative cents, one urgent project, any activity, or a
 * session today) flips this to false — "you have something to look at"
 * is not first week, even if everything else is empty.
 */
export function isFirstWeekEmptyState(input: {
  thisMonthCents: number;
  activityCount: number;
  urgentCount: number;
  hasTodaySession: boolean;
  pendingApprovalsCount: number;
}): boolean {
  return (
    input.thisMonthCents === 0 &&
    input.activityCount === 0 &&
    input.urgentCount === 0 &&
    !input.hasTodaySession &&
    input.pendingApprovalsCount === 0
  );
}

/**
 * Build a small SVG path (100×22 viewBox) from the 30-bucket sparkline.
 * Returns "" for empty / all-zero data so the consumer can hide the
 * SVG entirely (a flat baseline reads as a chart, which is misleading).
 */
export function buildSparkPath(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  if (max <= 0) return "";
  const W = 100;
  const H = 22;
  const PAD = 2;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;
  const step = values.length > 1 ? plotW / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = PAD + step * i;
      const y = PAD + plotH - (v / max) * plotH;
      const cmd = i === 0 ? "M" : "L";
      return `${cmd}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
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

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="rgb(var(--fg-muted))"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

function AlertCircleIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" />
    </svg>
  );
}

function ActivityGlyph() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 8.5h2.5L6 4.5l3 7 1.5-3H14" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v12" />
      <path d="M11 5.5a2.5 2.5 0 0 0-2.5-2.5h-1A2.5 2.5 0 0 0 5 5.5c0 1.4 1.1 2 2.5 2h1c1.4 0 2.5.6 2.5 2A2.5 2.5 0 0 1 8.5 12h-1A2.5 2.5 0 0 1 5 9.5" />
    </svg>
  );
}

function PlayCircleIcon() {
  return (
    <svg
      aria-hidden
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      stroke="rgb(var(--brand-primary))"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="16" cy="16" r="13" />
      <path d="M13 11.5v9l8-4.5z" fill="rgb(var(--brand-primary))" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="rgb(var(--fg-success))"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}
