import {
  Banknote,
  CalendarDays,
  ChevronRight,
  MessageSquareText,
  Mic,
  ReceiptText,
} from "lucide-react";
import Link from "next/link";

import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import type { Stage } from "~/lib/projects/stages";
import { STAGE_LABEL } from "~/lib/projects/stages";
import { formatRelativeTime } from "~/lib/time/relative";
import { formatMoney } from "~/lib/format/money";
import type { PendingPaymentProof } from "~/components/dashboard/requests/pending-payment-proofs";

import { MobilePaymentRow } from "./mobile-payment-row";

// MobileTodayFeed — the phone-only (<lg) replacement for the Overview
// page body. Gili's 2026-06-11 mobile audit: the home screen tried to
// be the whole desktop dashboard on a phone (player, KPIs, public
// link, uploads) — on mobile the producer just wants "what needs me,
// and what happened". So the feed is exactly that, in three bands:
//
//   1. Needs you      — action cards, each with one obvious next step:
//                       pending approvals, post-session follow-ups
//                       (grouped per project so two sessions on the
//                       same project no longer stack two identical
//                       cards), payments received (dismissible),
//                       urgent projects.
//   2. Today          — today's session, when there is one.
//   3. Recent activity — quiet rows; context, not chores.
//
// Desktop (lg+) keeps the full OverviewScreen — this component renders
// nothing there (`lg:hidden`), and OverviewScreen + the system banners
// are wrapped `hidden lg:block` by the page. Self-contained on purpose:
// no imports from overview-screen.tsx, so the desktop file stays
// byte-identical.

export interface MobileTodayFeedProps {
  displayName: string | null;
  pendingApprovals: Array<{
    id: string;
    artistName: string;
    startsAt: Date;
    packageNameSnapshot: string | null;
  }>;
  pendingPurchaseRequests: Array<{
    id: string;
    artistName: string;
    productNameSnapshot: string;
    priceCents: number | null;
    currency: string;
    commercialTermsAvailable: boolean;
  }>;
  pendingPaymentProofs: PendingPaymentProof[];
  /** Raw follow-up sessions; the feed groups them per project. */
  followUps: Array<{
    id: string;
    artistName: string;
    projectTitle: string;
    projectId: string;
  }>;
  payments: Array<{
    id: string;
    artistName: string;
    unitPriceCents: number | null;
    songQty: number | null;
    projectId: string | null;
    projectName: string;
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
    urgency: "overdue" | "deposit_due" | "stuck";
  }>;
  activity: Array<{
    id: string;
    kind: "session" | "payment" | "comment" | "invoice";
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;
    unread: boolean;
  }>;
  /** Skipper nudge — same condition the desktop FinishSetupNudge uses. */
  showSetupNudge: boolean;
  /** Server-provided "now" so date formatting stays stable across hydration. */
  now: Date;
}

export function MobileTodayFeed({
  displayName,
  pendingApprovals,
  pendingPurchaseRequests,
  pendingPaymentProofs,
  followUps,
  payments,
  todaySession,
  urgentProjects,
  activity,
  showSetupNudge,
  now,
}: MobileTodayFeedProps) {
  const greetingName = (displayName ?? "").trim().split(/\s+/)[0] || "there";

  // One card per project, not one per ended session — the audit
  // screenshot showed two identical "Session with NeedJuice is done"
  // cards for the same project.
  const followUpGroups = groupFollowUps(followUps);

  const needsYouCount =
    pendingApprovals.length +
    pendingPurchaseRequests.length +
    pendingPaymentProofs.length +
    followUpGroups.length +
    payments.length +
    urgentProjects.length +
    (showSetupNudge ? 1 : 0);

  const allClear = needsYouCount === 0 && todaySession === null && activity.length === 0;

  return (
    <div className="sk-page-enter mx-auto flex w-full flex-col gap-6 px-4 pt-5 pb-12 lg:hidden">
      {/* Greeting — compact on purpose; the feed is the hero here. */}
      <header className="reveal-up min-w-0">
        <span className="pill pill-success inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="ping-dot h-1.5 w-1.5 rounded-full"
            style={{ background: "rgb(var(--fg-success))" }}
          />
          Accepting Sessions
        </span>
        <h1 className="font-syne mt-2.5 text-[27px] leading-[1.04] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          {greetingFor(now)}, {greetingName}.
        </h1>
        <p className="mt-1 text-[13px] text-[rgb(var(--fg-muted))]">
          {needsYouCount > 0
            ? `${String(needsYouCount)} ${needsYouCount === 1 ? "thing needs" : "things need"} your attention.`
            : "All clear today."}
        </p>
      </header>

      {allClear ? (
        <div className="reveal-up reveal-up-delay-1 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-8 text-center">
          <p className="text-sm font-semibold text-[rgb(var(--fg-default))]">
            Nothing needs you right now.
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            New requests, payments and session updates will land here.
          </p>
        </div>
      ) : null}

      {/* — NEEDS YOU — */}
      {needsYouCount > 0 ? (
        <section aria-labelledby="mobile-needs-you" className="reveal-up reveal-up-delay-1">
          <FeedLabel id="mobile-needs-you" accent>
            Needs you
          </FeedLabel>
          <div className="flex flex-col gap-2.5">
            {showSetupNudge ? <SetupNudgeCard /> : null}

            {pendingPaymentProofs.map((proof) => (
              <PaymentProofCard key={proof.proofId} proof={proof} />
            ))}

            {pendingPurchaseRequests.map((request) => (
              <PurchaseRequestCard key={request.id} request={request} />
            ))}

            {pendingApprovals.map((a) => (
              <ApprovalCard key={a.id} approval={a} />
            ))}

            {followUpGroups.map((g) => (
              <FollowUpCard key={g.projectId} group={g} />
            ))}

            {payments.map((p) => (
              <MobilePaymentRow key={p.id} booking={p} />
            ))}

            {urgentProjects.length > 0 ? <UrgentList projects={urgentProjects} /> : null}
          </div>
        </section>
      ) : null}

      {/* — TODAY — */}
      {todaySession ? (
        <section aria-labelledby="mobile-today" className="reveal-up reveal-up-delay-2">
          <FeedLabel id="mobile-today">Today</FeedLabel>
          <Link
            href={todaySession.href}
            className="sk-press flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
          >
            <div className="w-14 shrink-0">
              <p className="font-mono text-[10px] font-bold tracking-[0.06em] text-[rgb(var(--brand-primary))] uppercase">
                {formatDayLabel(todaySession.occurredAt)}
              </p>
              <p className="font-display mt-0.5 text-[26px] leading-none font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))] tabular-nums">
                {formatHourMain(todaySession.occurredAt)}
                <span className="text-[14px] opacity-50">
                  :{formatMinuteSuffix(todaySession.occurredAt)}
                </span>
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] leading-tight font-bold text-[rgb(var(--fg-default))]">
                {todaySession.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
                {todaySession.subtitle}
              </p>
            </div>
            <ChevronRight size={16} aria-hidden className="shrink-0 text-[rgb(var(--fg-muted))]" />
          </Link>
        </section>
      ) : null}

      {/* — RECENT ACTIVITY — */}
      {activity.length > 0 ? (
        <section aria-labelledby="mobile-activity" className="reveal-up reveal-up-delay-2">
          <FeedLabel id="mobile-activity">Recent activity</FeedLabel>
          <ul className="flex flex-col rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
            {activity.slice(0, 8).map((item, i, arr) => (
              <li
                key={item.id}
                className={i < arr.length - 1 ? "border-b border-[rgb(var(--border-subtle))]" : ""}
              >
                <Link
                  href={item.href}
                  className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5"
                >
                  <ActivityGlyph kind={item.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] leading-snug text-[rgb(var(--fg-default))]">
                      {item.title}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-[rgb(var(--fg-muted))] tabular-nums">
                      {formatRelativeTime(item.occurredAt, now)} · {item.subtitle}
                    </p>
                  </div>
                  {item.unread ? (
                    <span
                      aria-label="unread"
                      className="ping-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]"
                    />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// — Cards —

function SetupNudgeCard() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.06)] p-4">
      <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
        Two minutes to your first bookable link
      </p>
      <p className="mt-0.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
        Add a service and your hours so clients can actually book you.
      </p>
      <a
        href="/dashboard/onboarding"
        className="sk-press mt-3 flex min-h-[44px] w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-semibold text-[rgb(var(--fg-inverse))]"
      >
        Finish setup
      </a>
    </div>
  );
}

function ApprovalCard({
  approval,
}: {
  approval: MobileTodayFeedProps["pendingApprovals"][number];
}) {
  return (
    <Link
      href={`/dashboard/calendar?booking=${approval.id}`}
      className="sk-press flex items-center gap-3 rounded-[var(--radius-lg)] border-[1.5px] border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--bg-elevated))] p-3.5 shadow-[0_4px_24px_rgb(var(--brand-primary)/0.08)]"
    >
      <FeedAvatar name={approval.artistName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] leading-tight font-bold text-[rgb(var(--fg-default))]">
          {approval.artistName}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {approval.packageNameSnapshot ?? "Session request"}
        </p>
        {/* Time on its own line — it's the decision-critical fact on an
            approval and must never truncate behind the package name. */}
        <p className="mt-0.5 font-mono text-[10.5px] text-[rgb(var(--fg-muted))] tabular-nums">
          {formatDateTime(approval.startsAt)}
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase">
        Review
        <ChevronRight size={12} aria-hidden />
      </span>
    </Link>
  );
}

function PurchaseRequestCard({
  request,
}: {
  request: MobileTodayFeedProps["pendingPurchaseRequests"][number];
}) {
  return (
    <Link
      href={`/dashboard/requests/${request.id}`}
      className="sk-press flex items-center gap-3 rounded-[var(--radius-lg)] border-[1.5px] border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--bg-elevated))] p-3.5 shadow-[0_4px_24px_rgb(var(--brand-primary)/0.08)]"
    >
      <FeedAvatar name={request.artistName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] leading-tight font-bold text-[rgb(var(--fg-default))]">
          {request.artistName}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {request.productNameSnapshot}
        </p>
        <p className="mt-1 font-mono text-[10.5px] font-semibold tracking-[0.06em] text-[rgb(var(--brand-primary))] uppercase">
          Purchase request ·{" "}
          {request.commercialTermsAvailable && request.priceCents !== null
            ? formatMoney(request.priceCents, request.currency)
            : "Terms unavailable"}
        </p>
      </div>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-[rgb(var(--brand-primary))]" />
    </Link>
  );
}

function PaymentProofCard({ proof }: { proof: PendingPaymentProof }) {
  return (
    <Link
      href={`/dashboard/requests/${proof.purchaseRequestId}?proof=${proof.proofId}#payment-proof`}
      className="sk-press rounded-[var(--radius-lg)] border-[1.5px] border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.06)] p-3.5 shadow-[0_4px_24px_rgb(var(--brand-primary)/0.1)]"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]"
        >
          <ReceiptText size={17} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9.5px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase">
            Payment proof · review now
          </p>
          <p className="mt-1 truncate text-[15px] leading-tight font-bold text-[rgb(var(--fg-default))]">
            {proof.artistName}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
            {proof.productNameSnapshot} · {proof.refNumber}
          </p>
        </div>
        <ChevronRight
          size={16}
          aria-hidden
          className="mt-1 shrink-0 text-[rgb(var(--brand-primary))]"
        />
      </div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-[rgb(var(--brand-primary)/0.2)] pt-2.5">
        <p className="min-w-0 truncate font-mono text-[10px] text-[rgb(var(--fg-muted))]">
          {proof.originalFileName ?? "Payment proof"}
        </p>
        <p className="shrink-0 font-mono text-[11px] font-bold text-[rgb(var(--fg-default))]">
          {formatMoney(proof.amountCents, proof.currency)}
        </p>
      </div>
      {proof.proofNote ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-[rgb(var(--fg-muted))]">
          “{proof.proofNote}”
        </p>
      ) : null}
    </Link>
  );
}

interface FollowUpGroup {
  projectId: string;
  artistName: string;
  projectTitle: string;
  count: number;
}

function groupFollowUps(followUps: MobileTodayFeedProps["followUps"]): FollowUpGroup[] {
  const groups = new Map<string, FollowUpGroup>();
  for (const s of followUps) {
    const existing = groups.get(s.projectId);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(s.projectId, {
        projectId: s.projectId,
        artistName: s.artistName,
        projectTitle: s.projectTitle,
        count: 1,
      });
    }
  }
  return [...groups.values()];
}

function FollowUpCard({ group }: { group: FollowUpGroup }) {
  const headline =
    group.count === 1
      ? `Session with ${group.artistName} is done`
      : `${String(group.count)} sessions with ${group.artistName} are done`;
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.06)] p-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary))]"
        >
          <Mic size={16} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-bold text-[rgb(var(--fg-default))]">
            {headline} — how did it go?
          </p>
          <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
            {group.projectTitle}
          </p>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-5 pl-12">
        <Link
          href={`/dashboard/clients-projects/${group.projectId}?tab=music`}
          className="inline-flex min-h-[44px] items-center font-mono text-[10.5px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase"
        >
          Upload files →
        </Link>
        <Link
          href={`/dashboard/clients-projects/${group.projectId}`}
          className="inline-flex min-h-[44px] items-center font-mono text-[10.5px] font-bold tracking-widest text-[rgb(var(--fg-secondary))] uppercase"
        >
          Update project →
        </Link>
      </div>
    </div>
  );
}

function UrgentList({ projects }: { projects: MobileTodayFeedProps["urgentProjects"] }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      {projects.map((p, i) => (
        <Link
          key={p.id}
          href={`/dashboard/clients-projects/${p.id}`}
          className={[
            "flex min-h-[60px] items-center gap-3 px-3.5 py-2.5",
            i < projects.length - 1 ? "border-b border-[rgb(var(--border-subtle))]" : "",
          ].join(" ")}
        >
          <span
            aria-hidden
            className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)]"
            style={{ background: p.gradient }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13.5px] font-bold tracking-[-0.01em] text-[rgb(var(--fg-default))]">
                {p.title}
              </span>
              <UrgencyPill urgency={p.urgency} />
            </div>
            <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
              {p.clientName || "—"}
              <span className="mx-1.5 opacity-40">·</span>
              {STAGE_LABEL[p.stage]}
            </p>
          </div>
          <ChevronRight size={16} aria-hidden className="shrink-0 text-[rgb(var(--fg-muted))]" />
        </Link>
      ))}
    </div>
  );
}

// — Atoms —

function FeedLabel({
  id,
  accent = false,
  children,
}: {
  id: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className={[
        "mb-2 px-1 font-mono text-[10px] font-bold tracking-widest uppercase",
        accent ? "text-[rgb(var(--brand-primary))]" : "text-[rgb(var(--fg-muted))]",
      ].join(" ")}
    >
      {children}
    </h2>
  );
}

function FeedAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
      style={{ background: producerGradient(name) }}
    >
      {producerInitials(name)}
    </span>
  );
}

// Same urgency-pill design language as the desktop Overview (red /
// amber / muted bordered chips) so the two surfaces stay one product.
function UrgencyPill({
  urgency,
}: {
  urgency: MobileTodayFeedProps["urgentProjects"][number]["urgency"];
}) {
  if (urgency === "overdue") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-widest text-[rgb(var(--fg-danger))] uppercase">
        Overdue
      </span>
    );
  }
  if (urgency === "deposit_due") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--fg-warning)/0.3)] bg-[rgb(var(--fg-warning)/0.10)] px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-widest text-[rgb(var(--fg-warning))] uppercase">
        Deposit due
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-overlay))] px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-widest text-[rgb(var(--fg-muted))] uppercase">
      Stuck
    </span>
  );
}

const ACTIVITY_GLYPH: Record<
  MobileTodayFeedProps["activity"][number]["kind"],
  typeof CalendarDays
> = {
  session: CalendarDays,
  payment: Banknote,
  comment: MessageSquareText,
  invoice: ReceiptText,
};

function ActivityGlyph({ kind }: { kind: MobileTodayFeedProps["activity"][number]["kind"] }) {
  const Icon = ACTIVITY_GLYPH[kind];
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-secondary))]"
    >
      <Icon size={14} strokeWidth={2} />
    </span>
  );
}

// — Formatting (mirrors overview-screen's private helpers; kept local
//    so the desktop file stays untouched) —

function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDayLabel(d: Date): string {
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(d.getDate())}`;
}

function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(d: Date): string {
  return `${formatDayLabel(d)} · ${formatTimeShort(d)}`;
}

function formatHourMain(d: Date): string {
  const hours = d.getHours() % 12 || 12;
  return String(hours);
}

function formatMinuteSuffix(d: Date): string {
  return String(d.getMinutes()).padStart(2, "0");
}
