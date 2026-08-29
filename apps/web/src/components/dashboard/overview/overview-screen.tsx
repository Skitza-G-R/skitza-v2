"use client";

import {
  AudioLines,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderClock,
  MessageSquareText,
  ReceiptText,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useRuntimeCachedView } from "~/components/runtime-state/use-runtime-state";
import { formatMoney } from "~/lib/format/money";
import type { Stage } from "~/lib/projects/stages";
import { STAGE_LABEL } from "~/lib/projects/stages";

import {
  buildNeedsYouQueue,
  capNeedsYouQueue,
  shortActionLabel,
  type AttentionDismissal,
  type NeedsYouItem,
  type PaymentBalanceSource,
  type PaymentProofSource,
} from "./needs-you";
import { NeedsYouDismissButton } from "./needs-you-dismiss-button";
import { PublicLinkStrip } from "./public-link-strip";
import { formatDashboardDate, formatDashboardTime, greetingFor } from "./overview-time";

export interface OverviewScreenProps {
  displayName: string | null;
  slug: string | null;
  timezone: string;
  pulseStats: {
    commercialAvailable: boolean;
    thisMonthCents: number | null;
    outstandingCents: number | null;
    currency: string | null;
    activeProjects: number;
  };
  paymentProofs: readonly PaymentProofSource[];
  paymentBalances: readonly PaymentBalanceSource[];
  purchaseRequests: Array<{
    id: string;
    artistName: string;
    productNameSnapshot: string;
  }>;
  pendingApprovals: Array<{
    id: string;
    artistName: string;
    artistEmail: string;
    startsAt: Date;
    durationMin: number;
    packageNameSnapshot: string | null;
    message: string | null;
  }>;
  todaySession: {
    id: string;
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;
  } | null;
  urgentProjects: Array<{
    id: string;
    title: string;
    clientName: string;
    gradient: string;
    stage: Stage;
    urgency: "stuck";
    lastActivityAt: Date;
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
  unresolvedItems: Array<{
    id: string;
    commentId: string;
    kind: "comment";
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;
    unread: boolean;
  }>;
  dismissals: AttentionDismissal[];
  showSetupNudge: boolean;
  showAllNeedsYou: boolean;
  now: Date;
}

const OVERVIEW_SCREEN_CLASS =
  "sk-page-enter mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pt-5 pb-10 sm:px-6 lg:gap-5 lg:px-8 lg:pt-8 lg:pb-8";

export function OverviewScreen({
  displayName: serverDisplayName,
  slug,
  timezone,
  pulseStats: serverPulseStats,
  paymentProofs,
  paymentBalances,
  purchaseRequests,
  pendingApprovals,
  todaySession,
  urgentProjects,
  recentUploads,
  unresolvedItems,
  dismissals,
  showSetupNudge,
  showAllNeedsYou,
  now,
}: OverviewScreenProps) {
  const online = useOnlineStatus();
  const overviewServerData = useMemo(
    () => ({
      displayName: serverDisplayName,
      activeProjects: serverPulseStats.activeProjects,
    }),
    [serverDisplayName, serverPulseStats.activeProjects],
  );
  const cachedView = useRuntimeCachedView({
    slot: "producer.overview.safe-view",
    route: showAllNeedsYou ? "/dashboard?view=all" : "/dashboard",
    serverData: overviewServerData,
  });
  const displayName = cachedView.data?.displayName ?? serverDisplayName;
  const pulseStats = {
    ...serverPulseStats,
    activeProjects: cachedView.data?.activeProjects ?? serverPulseStats.activeProjects,
  };
  const firstName = (displayName ?? "").trim().split(/\s+/)[0] || "there";
  const needsYouItems = buildNeedsYouQueue({
    paymentProofs,
    paymentBalances,
    purchaseRequests,
    pendingApprovals,
    unresolvedItems,
    urgentProjects,
    dismissals,
    showSetupNudge,
  });

  if (!online) {
    return (
      <div
        data-runtime-source={cachedView.source}
        data-runtime-refreshing={cachedView.refreshing || undefined}
        className={OVERVIEW_SCREEN_CLASS}
      >
        <p
          role="status"
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--fg-warning-text))]"
        >
          Offline · Showing your saved studio overview. Booking, payment, availability, and other
          live actions need a connection.
        </p>
        <section
          aria-labelledby="offline-overview-heading"
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-sm)]"
        >
          <h1
            data-gate1-meaningful-title
            id="offline-overview-heading"
            className="font-syne text-[28px] leading-tight font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]"
          >
            Welcome back, {firstName}.
          </h1>
          <p className="mt-3 text-[13px] text-[rgb(var(--fg-muted))]">Saved studio pulse</p>
          <p className="mt-1 text-2xl font-extrabold text-[rgb(var(--fg-default))]">
            {String(pulseStats.activeProjects)}
          </p>
          <p className="text-[12px] text-[rgb(var(--fg-muted))]">Active projects</p>
        </section>
      </div>
    );
  }

  return (
    <div
      data-runtime-source={cachedView.source}
      data-runtime-refreshing={cachedView.refreshing || undefined}
      className={OVERVIEW_SCREEN_CLASS}
    >
      <div className="flex flex-col gap-4 lg:gap-5">
        <header className="reveal-up flex min-w-0 items-end justify-between gap-6">
          <div className="min-w-0">
            <h1
              data-gate1-meaningful-title
              className="font-syne text-[32px] leading-[0.98] font-extrabold tracking-[-0.03em] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))] lg:text-[38px]"
            >
              {greetingFor(now, timezone)}, {firstName}.
            </h1>
            <p className="mt-2 text-[15px] text-[rgb(var(--fg-muted))] lg:text-sm">
              {needsYouItems.length > 0
                ? `${String(needsYouItems.length)} ${needsYouItems.length === 1 ? "thing needs" : "things need"} your attention.`
                : "Here is the pulse of your studio today."}
            </p>
          </div>
          {slug ? <PublicLinkStrip slug={slug} /> : null}
        </header>

        <NeedsYouPanel items={needsYouItems} showAll={showAllNeedsYou} />

        {todaySession ? <MobileTodayCard session={todaySession} timezone={timezone} /> : null}

        <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-5 lg:grid">
          <UrgentProjectsCard projects={urgentProjects} />
          <LatestUploadsCard uploads={recentUploads.slice(0, 2)} timezone={timezone} />
        </div>

        <StudioPulse pulseStats={pulseStats} />

        <MobileLatestUpload upload={recentUploads[0] ?? null} timezone={timezone} />
      </div>
    </div>
  );
}

function NeedsYouPanel({ items, showAll }: { items: readonly NeedsYouItem[]; showAll: boolean }) {
  const { visible, hiddenCount } = capNeedsYouQueue(items, showAll);
  return (
    <section
      id="needs-you"
      aria-labelledby="needs-you-heading"
      className="reveal-up reveal-up-delay-1 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-sidebar))] bg-[rgb(var(--bg-sidebar))] px-4 pt-4 shadow-[var(--shadow-sm)] lg:border-[rgb(var(--border-subtle))] lg:bg-[rgb(var(--bg-elevated))] lg:px-5 lg:pt-4"
    >
      <h2
        id="needs-you-heading"
        className="pb-2 font-mono text-[11px] font-semibold tracking-[0.2em] text-[rgb(var(--fg-onsidebar))] uppercase lg:text-[rgb(var(--fg-default))]"
      >
        Needs you
      </h2>
      {visible.length === 0 ? (
        <div className="flex min-h-[72px] items-center gap-3 border-t border-[rgb(var(--fg-onsidebar)/0.16)] py-3 lg:border-[rgb(var(--border-subtle))]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--fg-success)/0.45)] text-[rgb(var(--fg-success))]">
            <CheckCircle2 aria-hidden size={19} />
          </span>
          <div>
            <p className="text-sm font-bold text-[rgb(var(--fg-onsidebar))] lg:text-[rgb(var(--fg-default))]">
              Nothing needs you right now.
            </p>
            <p className="mt-0.5 text-xs text-[rgb(var(--fg-onsidebar)/0.62)] lg:text-[rgb(var(--fg-muted))]">
              New requests, payments, and comments will appear here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="border-t border-[rgb(var(--fg-onsidebar)/0.16)] lg:border-[rgb(var(--border-subtle))]">
          {visible.map((item) => (
            <NeedsYouRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      {hiddenCount > 0 ? (
        <Link
          href="/dashboard?view=all#needs-you"
          className="flex min-h-11 items-center justify-center border-t border-[rgb(var(--fg-onsidebar)/0.16)] font-mono text-[10.5px] font-semibold tracking-[0.12em] text-[rgb(var(--brand-primary))] uppercase focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset lg:border-[rgb(var(--border-subtle))] lg:text-[rgb(var(--brand-primary-text))]"
        >
          View all {items.length} actions
        </Link>
      ) : showAll && items.length > 3 ? (
        <Link
          href="/dashboard#needs-you"
          className="flex min-h-11 items-center justify-center border-t border-[rgb(var(--fg-onsidebar)/0.16)] font-mono text-[10.5px] font-semibold tracking-[0.12em] text-[rgb(var(--brand-primary))] uppercase focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset lg:border-[rgb(var(--border-subtle))] lg:text-[rgb(var(--brand-primary-text))]"
        >
          Show top 3
        </Link>
      ) : null}
    </section>
  );
}

function NeedsYouRow({ item }: { item: NeedsYouItem }) {
  const primary = item.actionLabel === "Review";
  const shortLabel = shortActionLabel(item.actionLabel);
  // Optimistic hide lives here rather than in the button so the whole row
  // leaves at once. The button puts it straight back if the save fails.
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <li className="flex min-h-[72px] min-w-0 items-center gap-2.5 border-b border-[rgb(var(--fg-onsidebar)/0.16)] py-3 last:border-b-0 lg:min-h-[68px] lg:border-[rgb(var(--border-subtle))] lg:py-2.5">
      <ActionIcon kind={item.kind} />
      <div className="min-w-0 flex-1">
        <span className="block text-[15px] leading-tight font-bold [overflow-wrap:anywhere] text-[rgb(var(--fg-onsidebar))] lg:truncate lg:text-[rgb(var(--fg-default))]">
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-[rgb(var(--fg-onsidebar)/0.62)] lg:text-[rgb(var(--fg-muted))]">
          {item.meta}
        </span>
      </div>
      <ChevronRight
        aria-hidden
        size={17}
        className="hidden shrink-0 text-[rgb(var(--fg-muted))] sm:block"
      />
      <Link
        href={item.href}
        aria-label={`${item.actionLabel}: ${item.title} — ${item.meta}`}
        className={[
          "sk-press inline-flex h-11 min-w-[64px] shrink-0 items-center justify-center rounded-[var(--radius-lg)] px-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none lg:h-10 lg:min-w-[112px] lg:rounded-[var(--radius-md)]",
          primary
            ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
            : "border border-[rgb(var(--fg-onsidebar)/0.34)] text-[rgb(var(--fg-onsidebar))] lg:border-[rgb(var(--border-strong))] lg:text-[rgb(var(--fg-default))]",
        ].join(" ")}
      >
        <span className="lg:hidden">{shortLabel}</span>
        <span className="hidden lg:inline">{item.actionLabel}</span>
      </Link>
      {item.dismiss ? (
        <NeedsYouDismissButton
          dismiss={item.dismiss}
          title={item.title}
          meta={item.meta}
          onDismissed={() => {
            setHidden(true);
          }}
          onRestored={() => {
            setHidden(false);
          }}
        />
      ) : null}
    </li>
  );
}

function ActionIcon({ kind }: { kind: NeedsYouItem["kind"] }) {
  const icon = (() => {
    if (kind === "payment_proof") return <ReceiptText aria-hidden size={19} />;
    if (kind === "purchase_request") return <FileText aria-hidden size={19} />;
    if (kind === "session_approval") return <CalendarDays aria-hidden size={19} />;
    if (kind === "comment") return <MessageSquareText aria-hidden size={19} />;
    if (kind === "setup") return <Settings2 aria-hidden size={19} />;
    if (kind === "urgent_project") return <FolderClock aria-hidden size={19} />;
    return <CircleAlert aria-hidden size={19} />;
  })();
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary)/0.45)] text-[rgb(var(--brand-primary))] lg:h-9 lg:w-9 lg:border-[rgb(var(--brand-primary-text)/0.5)] lg:text-[rgb(var(--brand-primary-text))]">
      {icon}
    </span>
  );
}

function MobileTodayCard({
  session,
  timezone,
}: {
  session: NonNullable<OverviewScreenProps["todaySession"]>;
  timezone: string;
}) {
  return (
    <Link
      href={session.href}
      className="reveal-up reveal-up-delay-2 flex min-h-[96px] items-center gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none lg:hidden"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-default))]">
        <CalendarDays aria-hidden size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10.5px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-default))] uppercase">
          Today
        </span>
        <span className="mt-1 block font-mono text-[13px] font-semibold tracking-[0.08em] text-[rgb(var(--brand-primary-text))] uppercase">
          {formatDashboardTime(session.occurredAt, timezone)}
        </span>
        <span className="mt-0.5 block truncate text-[17px] font-bold text-[rgb(var(--fg-default))]">
          {session.title}
        </span>
      </span>
      <ChevronRight aria-hidden size={20} />
    </Link>
  );
}

function UrgentProjectsCard({ projects }: { projects: OverviewScreenProps["urgentProjects"] }) {
  return (
    <section
      aria-labelledby="urgent-projects-heading"
      className="flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-4 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="urgent-projects-heading"
        className="pb-2 font-mono text-[10.5px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-default))] uppercase"
      >
        Urgent projects
      </h2>
      <ul className="flex-1 border-t border-[rgb(var(--border-subtle))]">
        {projects.length === 0 ? (
          <li className="flex min-h-[64px] items-center text-sm text-[rgb(var(--fg-muted))]">
            Nothing urgent — your projects are moving.
          </li>
        ) : (
          projects.slice(0, 2).map((project) => (
            <li
              key={project.id}
              className="border-b border-[rgb(var(--border-subtle))] last:border-b-0"
            >
              <Link
                href={`/dashboard/clients-projects/${project.id}`}
                className="flex min-h-[72px] items-center gap-3 rounded-[var(--radius-sm)] py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
              >
                <span
                  aria-hidden
                  className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)]"
                  style={{ background: project.gradient }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                      {project.title}
                    </span>
                    <UrgencyBadge />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[rgb(var(--fg-muted))]">
                    {project.clientName || "Client"} · {STAGE_LABEL[project.stage]}
                  </span>
                </span>
                <ChevronRight aria-hidden size={17} />
              </Link>
            </li>
          ))
        )}
      </ul>
      <Link
        href="/dashboard/clients-projects"
        className="mt-auto flex min-h-11 items-center justify-center border-t border-[rgb(var(--border-subtle))] font-mono text-[10px] font-semibold tracking-[0.12em] text-[rgb(var(--brand-primary-text))] uppercase focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
      >
        View all projects
      </Link>
    </section>
  );
}

function LatestUploadsCard({
  uploads,
  timezone,
}: {
  uploads: OverviewScreenProps["recentUploads"];
  timezone: string;
}) {
  return (
    <section
      aria-labelledby="latest-uploads-heading"
      className="flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-4 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="latest-uploads-heading"
        className="pb-2 font-mono text-[10.5px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-default))] uppercase"
      >
        Latest uploads
      </h2>
      <ul className="flex-1 border-t border-[rgb(var(--border-subtle))]">
        {uploads.length === 0 ? (
          <li className="flex min-h-[64px] items-center text-sm text-[rgb(var(--fg-muted))]">
            Uploads will appear here.
          </li>
        ) : (
          uploads.map((upload) => (
            <li
              key={upload.versionId}
              className="border-b border-[rgb(var(--border-subtle))] last:border-b-0"
            >
              <Link
                href={`/dashboard/music/${upload.versionId}`}
                prefetch={false}
                className="flex min-h-[72px] items-center gap-3 rounded-[var(--radius-sm)] py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary-text))] text-[rgb(var(--brand-primary-text))]">
                  <AudioLines aria-hidden size={17} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                  {upload.title}
                </span>
                <UploadMeta
                  label="Uploaded"
                  value={formatDashboardDate(upload.uploadedAt, timezone)}
                />
                <UploadMeta label="Duration" value={formatDuration(upload.durationMs)} mono />
                <ChevronRight aria-hidden size={17} />
              </Link>
            </li>
          ))
        )}
      </ul>
      <Link
        href="/dashboard/music"
        className="mt-auto flex min-h-11 items-center justify-center border-t border-[rgb(var(--border-subtle))] font-mono text-[10px] font-semibold tracking-[0.12em] text-[rgb(var(--brand-primary-text))] uppercase focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
      >
        View all uploads
      </Link>
    </section>
  );
}

function UploadMeta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span className="w-[78px] shrink-0 text-right">
      <span className="block font-mono text-[8.5px] font-semibold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </span>
      <span
        className={`${mono ? "font-mono" : ""} mt-0.5 block text-xs font-semibold text-[rgb(var(--fg-default))]`}
      >
        {value}
      </span>
    </span>
  );
}

function StudioPulse({ pulseStats }: { pulseStats: OverviewScreenProps["pulseStats"] }) {
  return (
    <section
      aria-label="Studio pulse"
      className={`reveal-up reveal-up-delay-3 grid overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)] ${pulseStats.commercialAvailable ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}
    >
      {pulseStats.commercialAvailable &&
      pulseStats.thisMonthCents !== null &&
      pulseStats.outstandingCents !== null &&
      pulseStats.currency !== null ? (
        <>
          <PulseStat
            label="Earned this month"
            value={formatMoney(pulseStats.thisMonthCents, pulseStats.currency)}
            className="hidden lg:block"
          />
          <PulseStat
            label="Outstanding"
            value={formatMoney(pulseStats.outstandingCents, pulseStats.currency)}
          />
        </>
      ) : null}
      <PulseStat label="Active projects" value={String(pulseStats.activeProjects)} last />
    </section>
  );
}

function PulseStat({
  label,
  value,
  className = "",
  last = false,
}: {
  label: string;
  value: string;
  className?: string;
  last?: boolean;
}) {
  return (
    <div
      data-gate1-meaningful-item={last ? "" : undefined}
      className={`${last ? "" : "border-r border-[rgb(var(--border-subtle))]"} ${className} min-w-0 px-4 py-5 lg:px-6`}
    >
      <p className="font-mono text-[9.5px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-default))] uppercase">
        {label}
      </p>
      <p className="font-syne mt-2 truncate text-[30px] leading-none font-bold tracking-[-0.035em] text-[rgb(var(--fg-default))] tabular-nums lg:text-[34px]">
        {value}
      </p>
    </div>
  );
}

function MobileLatestUpload({
  upload,
  timezone,
}: {
  upload: OverviewScreenProps["recentUploads"][number] | null;
  timezone: string;
}) {
  if (!upload) return null;
  return (
    <Link
      href={`/dashboard/music/${upload.versionId}`}
      prefetch={false}
      className="reveal-up reveal-up-delay-3 flex min-h-[94px] items-center gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none lg:hidden"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary-text))] text-[rgb(var(--brand-primary-text))]">
        <AudioLines aria-hidden size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10.5px] font-semibold tracking-[0.18em] text-[rgb(var(--fg-default))] uppercase">
          Latest upload
        </span>
        <span className="mt-1 block truncate text-[17px] font-bold text-[rgb(var(--fg-default))]">
          {upload.title}
        </span>
        <span className="mt-0.5 block font-mono text-xs text-[rgb(var(--fg-muted))]">
          {formatDashboardDate(upload.uploadedAt, timezone)} · {formatDuration(upload.durationMs)}
        </span>
      </span>
      <ChevronRight aria-hidden size={20} />
    </Link>
  );
}

function UrgencyBadge() {
  return (
    <span className="shrink-0 rounded-[var(--radius-sm)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-2 py-1 font-mono text-[8.5px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-danger-text))] uppercase">
      Stuck
    </span>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
