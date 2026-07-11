import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderClock,
  MessageSquareText,
  Play,
  Settings2,
} from "lucide-react";
import Link from "next/link";

import { formatMoney } from "~/lib/format/money";
import type { Stage } from "~/lib/projects/stages";
import { STAGE_LABEL } from "~/lib/projects/stages";

import {
  buildNeedsYouQueue,
  capNeedsYouQueue,
  type NeedsYouItem,
  type PaymentSource,
} from "./needs-you";
import { NeedsYouPaymentRow } from "./needs-you-payment-row";
import { PublicLinkStrip } from "./public-link-strip";

export interface OverviewScreenProps {
  displayName: string | null;
  slug: string | null;
  pulseStats: {
    thisMonthCents: number;
    outstandingCents: number;
    currency: string;
    activeProjects: number;
  };
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
  followUps: Array<{
    id: string;
    artistName: string;
    projectTitle: string;
    projectId: string;
    count?: number;
  }>;
  payments: PaymentSource[];
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
  unresolvedItems: Array<{
    id: string;
    kind: "comment" | "invoice";
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;
    unread: boolean;
  }>;
  showSetupNudge: boolean;
  showAllNeedsYou: boolean;
  now: Date;
}

export function OverviewScreen({
  displayName,
  slug,
  pulseStats,
  purchaseRequests,
  pendingApprovals,
  followUps,
  payments,
  todaySession,
  urgentProjects,
  recentUploads,
  unresolvedItems,
  showSetupNudge,
  showAllNeedsYou,
  now,
}: OverviewScreenProps) {
  const firstName = (displayName ?? "").trim().split(/\s+/)[0] || "there";
  const needsYouItems = buildNeedsYouQueue({
    purchaseRequests,
    pendingApprovals,
    followUps,
    unresolvedItems,
    urgentProjects,
    payments,
    showSetupNudge,
  });

  return (
    <div className="sk-page-enter mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 pb-10 pt-5 sm:px-6 lg:gap-5 lg:px-8 lg:pb-8 lg:pt-8">
      <header className="reveal-up flex min-w-0 items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-syne text-[32px] font-extrabold leading-[0.98] tracking-[-0.03em] text-[rgb(var(--fg-default))] lg:text-[38px]">
            {greetingFor(now)}, {firstName}.
          </h1>
          <p className="mt-2 text-[15px] text-[rgb(var(--fg-muted))] lg:text-sm">
            {needsYouItems.length > 0
              ? `${String(needsYouItems.length)} ${needsYouItems.length === 1 ? "thing needs" : "things need"} your attention.`
              : "Here is the pulse of your studio today."}
          </p>
        </div>
        {slug ? <PublicLinkStrip slug={slug} /> : null}
      </header>

      <NeedsYouPanel
        items={needsYouItems}
        showAll={showAllNeedsYou}
      />

      {todaySession ? <MobileTodayCard session={todaySession} /> : null}

      <div className="hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-5 lg:grid">
        <UrgentProjectsCard projects={urgentProjects} />
        <LatestUploadsCard uploads={recentUploads.slice(0, 2)} />
      </div>

      <StudioPulse pulseStats={pulseStats} />

      <MobileLatestUpload upload={recentUploads[0] ?? null} />
    </div>
  );
}

function NeedsYouPanel({
  items,
  showAll,
}: {
  items: readonly NeedsYouItem[];
  showAll: boolean;
}) {
  const { visible, hiddenCount } = capNeedsYouQueue(items, showAll);
  return (
    <section
      id="needs-you"
      aria-labelledby="needs-you-heading"
      className="reveal-up reveal-up-delay-1 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-sidebar))] bg-[rgb(var(--bg-sidebar))] px-4 pt-4 shadow-[var(--shadow-sm)] lg:border-[rgb(var(--border-subtle))] lg:bg-[rgb(var(--bg-elevated))] lg:px-5 lg:pt-4"
    >
      <h2
        id="needs-you-heading"
        className="pb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--fg-onsidebar))] lg:text-[rgb(var(--fg-default))]"
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
              New requests, payments, and follow-ups will appear here.
            </p>
          </div>
        </div>
      ) : (
        <ul className="border-t border-[rgb(var(--fg-onsidebar)/0.16)] lg:border-[rgb(var(--border-subtle))]">
          {visible.map((item) =>
            item.kind === "payment_received" && item.payment ? (
              <NeedsYouPaymentRow key={item.id} payment={item.payment} />
            ) : (
              <NeedsYouRow key={item.id} item={item} />
            ),
          )}
        </ul>
      )}
      {hiddenCount > 0 ? (
        <Link
          href="/dashboard?view=all#needs-you"
          className="flex min-h-11 items-center justify-center border-t border-[rgb(var(--fg-onsidebar)/0.16)] font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))] lg:border-[rgb(var(--border-subtle))]"
        >
          View all {items.length} actions
        </Link>
      ) : showAll && items.length > 3 ? (
        <Link
          href="/dashboard#needs-you"
          className="flex min-h-11 items-center justify-center border-t border-[rgb(var(--fg-onsidebar)/0.16)] font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))] lg:border-[rgb(var(--border-subtle))]"
        >
          Show top 3
        </Link>
      ) : null}
    </section>
  );
}

function NeedsYouRow({ item }: { item: NeedsYouItem }) {
  const primary = item.actionLabel === "Review";
  const shortLabel = item.actionLabel === "Open project" ? "Open" : item.actionLabel;
  return (
    <li className="flex min-h-[72px] min-w-0 items-center gap-3 border-b border-[rgb(var(--fg-onsidebar)/0.16)] py-3 last:border-b-0 lg:min-h-[68px] lg:border-[rgb(var(--border-subtle))] lg:py-2.5">
      <ActionIcon kind={item.kind} />
      <Link href={item.href} className="min-w-0 flex-1 focus-visible:outline-none">
        <span className="block truncate text-[15px] font-bold text-[rgb(var(--fg-onsidebar))] lg:text-[rgb(var(--fg-default))]">
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-[rgb(var(--fg-onsidebar)/0.62)] lg:text-[rgb(var(--fg-muted))]">
          {item.meta}
        </span>
      </Link>
      <ChevronRight
        aria-hidden
        size={17}
        className="hidden shrink-0 text-[rgb(var(--fg-muted))] sm:block"
      />
      <Link
        href={item.href}
        className={[
          "sk-press inline-flex h-11 min-w-[76px] shrink-0 items-center justify-center rounded-[var(--radius-lg)] px-3 text-sm font-semibold lg:h-10 lg:min-w-[112px] lg:rounded-[var(--radius-md)]",
          primary
            ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
            : "border border-[rgb(var(--fg-onsidebar)/0.34)] text-[rgb(var(--fg-onsidebar))] lg:border-[rgb(var(--border-strong))] lg:text-[rgb(var(--fg-default))]",
        ].join(" ")}
      >
        <span className="lg:hidden">{shortLabel}</span>
        <span className="hidden lg:inline">{item.actionLabel}</span>
      </Link>
    </li>
  );
}

function ActionIcon({ kind }: { kind: NeedsYouItem["kind"] }) {
  const icon = (() => {
    if (kind === "purchase_request") return <FileText aria-hidden size={19} />;
    if (kind === "session_approval") return <CalendarDays aria-hidden size={19} />;
    if (kind === "follow_up") return <CheckCircle2 aria-hidden size={19} />;
    if (kind === "comment") return <MessageSquareText aria-hidden size={19} />;
    if (kind === "setup") return <Settings2 aria-hidden size={19} />;
    if (kind === "urgent_project") return <FolderClock aria-hidden size={19} />;
    return <CircleAlert aria-hidden size={19} />;
  })();
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary)/0.45)] text-[rgb(var(--brand-primary))] lg:h-9 lg:w-9">
      {icon}
    </span>
  );
}

function MobileTodayCard({
  session,
}: {
  session: NonNullable<OverviewScreenProps["todaySession"]>;
}) {
  return (
    <Link
      href={session.href}
      className="reveal-up reveal-up-delay-2 flex min-h-[96px] items-center gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[var(--shadow-sm)] lg:hidden"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-default))]">
        <CalendarDays aria-hidden size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-default))]">
          Today
        </span>
        <span className="mt-1 block font-mono text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--brand-primary))]">
          {formatTime(session.occurredAt)}
        </span>
        <span className="mt-0.5 block truncate text-[17px] font-bold text-[rgb(var(--fg-default))]">
          {session.title}
        </span>
      </span>
      <ChevronRight aria-hidden size={20} />
    </Link>
  );
}

function UrgentProjectsCard({
  projects,
}: {
  projects: OverviewScreenProps["urgentProjects"];
}) {
  return (
    <section
      aria-labelledby="urgent-projects-heading"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-4 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="urgent-projects-heading"
        className="pb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-default))]"
      >
        Urgent projects
      </h2>
      <ul className="border-t border-[rgb(var(--border-subtle))]">
        {projects.length === 0 ? (
          <li className="flex min-h-[64px] items-center text-sm text-[rgb(var(--fg-muted))]">
            Nothing urgent — your projects are moving.
          </li>
        ) : (
          projects.slice(0, 2).map((project) => (
            <li key={project.id} className="border-b border-[rgb(var(--border-subtle))] last:border-b-0">
              <Link
                href={`/dashboard/clients-projects/${project.id}`}
                className="flex min-h-[72px] items-center gap-3 py-2.5"
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
                    <UrgencyBadge urgency={project.urgency} />
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
        className="flex min-h-11 items-center justify-center border-t border-[rgb(var(--border-subtle))] font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]"
      >
        View all projects
      </Link>
    </section>
  );
}

function LatestUploadsCard({
  uploads,
}: {
  uploads: OverviewScreenProps["recentUploads"];
}) {
  return (
    <section
      aria-labelledby="latest-uploads-heading"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 pt-4 shadow-[var(--shadow-sm)]"
    >
      <h2
        id="latest-uploads-heading"
        className="pb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-default))]"
      >
        Latest uploads
      </h2>
      <ul className="border-t border-[rgb(var(--border-subtle))]">
        {uploads.length === 0 ? (
          <li className="flex min-h-[64px] items-center text-sm text-[rgb(var(--fg-muted))]">
            Uploads will appear here.
          </li>
        ) : (
          uploads.map((upload) => (
            <li key={upload.versionId} className="border-b border-[rgb(var(--border-subtle))] last:border-b-0">
              <Link
                href={`/dashboard/music/${upload.versionId}`}
                className="flex min-h-[72px] items-center gap-3 py-2.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary))] text-[rgb(var(--brand-primary))]">
                  <Play aria-hidden size={15} fill="currentColor" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                  {upload.title}
                </span>
                <UploadMeta label="Uploaded" value={formatUploadDate(upload.uploadedAt)} />
                <UploadMeta label="Duration" value={formatDuration(upload.durationMs)} mono />
                <ChevronRight aria-hidden size={17} />
              </Link>
            </li>
          ))
        )}
      </ul>
      <Link
        href="/dashboard/music"
        className="flex min-h-11 items-center justify-center border-t border-[rgb(var(--border-subtle))] font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]"
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
      <span className="block font-mono text-[8.5px] font-semibold uppercase tracking-[0.13em] text-[rgb(var(--fg-muted))]">
        {label}
      </span>
      <span className={`${mono ? "font-mono" : ""} mt-0.5 block text-xs font-semibold text-[rgb(var(--fg-default))]`}>
        {value}
      </span>
    </span>
  );
}

function StudioPulse({
  pulseStats,
}: {
  pulseStats: OverviewScreenProps["pulseStats"];
}) {
  return (
    <section
      aria-label="Studio pulse"
      className="reveal-up reveal-up-delay-3 grid grid-cols-2 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)] lg:grid-cols-3"
    >
      <PulseStat
        label="Earned this month"
        value={formatMoney(pulseStats.thisMonthCents, pulseStats.currency)}
        className="hidden lg:block"
      />
      <PulseStat
        label="Outstanding"
        value={formatMoney(pulseStats.outstandingCents, pulseStats.currency)}
      />
      <PulseStat
        label="Active projects"
        value={String(pulseStats.activeProjects)}
        last
      />
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
      className={`${last ? "" : "border-r border-[rgb(var(--border-subtle))]"} ${className} min-w-0 px-4 py-5 lg:px-6`}
    >
      <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-default))]">
        {label}
      </p>
      <p className="font-syne mt-2 truncate text-[30px] font-bold leading-none tracking-[-0.035em] tabular-nums text-[rgb(var(--fg-default))] lg:text-[34px]">
        {value}
      </p>
    </div>
  );
}

function MobileLatestUpload({
  upload,
}: {
  upload: OverviewScreenProps["recentUploads"][number] | null;
}) {
  if (!upload) return null;
  return (
    <Link
      href={`/dashboard/music/${upload.versionId}`}
      className="reveal-up reveal-up-delay-3 flex min-h-[94px] items-center gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 shadow-[var(--shadow-sm)] lg:hidden"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary))] text-[rgb(var(--brand-primary))]">
        <Play aria-hidden size={17} fill="currentColor" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-default))]">
          Latest upload
        </span>
        <span className="mt-1 block truncate text-[17px] font-bold text-[rgb(var(--fg-default))]">
          {upload.title}
        </span>
        <span className="mt-0.5 block font-mono text-xs text-[rgb(var(--fg-muted))]">
          {formatUploadDate(upload.uploadedAt)} · {formatDuration(upload.durationMs)}
        </span>
      </span>
      <ChevronRight aria-hidden size={20} />
    </Link>
  );
}

function UrgencyBadge({
  urgency,
}: {
  urgency: "overdue" | "deposit_due" | "stuck";
}) {
  const label =
    urgency === "overdue"
      ? "Overdue"
      : urgency === "deposit_due"
        ? "Deposit due"
        : "Stuck";
  return (
    <span className="shrink-0 rounded-[var(--radius-sm)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-2 py-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--fg-danger))]">
      {label}
    </span>
  );
}

function greetingFor(now: Date): "Good morning" | "Good afternoon" | "Good evening" {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatUploadDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}
