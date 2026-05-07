import Link from "next/link";

import { producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";
import { STAGE_LABEL, type Stage } from "~/lib/projects/stages";
import { formatRelativeTime } from "~/lib/time/relative";

// Overview panel — landing tab on the client detail page.
//
// Two-column layout matching the founder's HTML mockup: the left rail
// holds "Active projects" + "Recent activity" (the day-to-day work),
// and the right rail holds "Financial relationship" (a glanceable
// money summary).
//
// Per founder direction (2026-05-07):
//   • Recent activity comments render as chat bubbles — producer-side
//     messages right-aligned with a dark bubble + initials chip;
//     client-side messages left-aligned with their initials avatar +
//     a soft cream bubble. Project stage events stay as plain
//     timeline lines so they don't masquerade as conversation.
//   • Active project rows ditch the bordered-card frame and lean
//     into a 1px hairline divider. The progress bar now uses the
//     full near-black fill on a soft track so the % reads at a
//     glance even on the warm-cream background.
//   • "Send payment reminder" CTA is gone — the financial card is
//     informational; producer takes action from a project page.

type Project = {
  id: string;
  title: string;
  stage: Stage;
  finalPaid: boolean;
  depositPaid: boolean;
  priceCents: number;
  currency: string | null;
  nextSessionAt: Date | string | null;
  outstandingCents: number;
  updatedAt: Date | string;
};

type Comment = {
  id: string;
  body: string;
  fromProducer: boolean;
  createdAt: Date | string;
  projectId: string;
};

const STAGE_PROGRESS: Record<Stage, number> = {
  lead: 10,
  booked: 25,
  in_production: 65,
  final_review: 85,
  paid: 100,
  archived: 100,
};

export function ClientOverviewPanel({
  clientId,
  clientName,
  projects,
  comments,
  stats,
  currency,
}: {
  clientId: string;
  clientName: string;
  projects: Project[];
  comments: Comment[];
  stats: { lifetimeCents: number; outstandingCents: number };
  currency: string;
}) {
  const activeProjects = projects.filter(
    (p) => p.stage !== "paid" && p.stage !== "archived",
  );
  const billedCents = stats.lifetimeCents + stats.outstandingCents;
  const settledPct =
    billedCents > 0
      ? Math.round((stats.lifetimeCents / billedCents) * 100)
      : 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
      {/* LEFT (2/3 on lg+) — active projects + recent activity */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        <ActiveProjectsCard
          clientId={clientId}
          projects={activeProjects}
          totalProjects={projects.length}
        />
        <RecentActivityCard
          projects={projects}
          comments={comments}
          clientName={clientName}
        />
      </div>

      {/* RIGHT (1/3 on lg+) — financial relationship */}
      <div>
        <FinancialRelationshipCard
          paidCents={stats.lifetimeCents}
          billedCents={billedCents}
          owedCents={stats.outstandingCents}
          settledPct={settledPct}
          currency={currency}
        />
      </div>
    </div>
  );
}

// ─── Active projects ────────────────────────────────────────────────

function ActiveProjectsCard({
  clientId,
  projects,
  totalProjects,
}: {
  clientId: string;
  projects: Project[];
  totalProjects: number;
}) {
  return (
    <section
      aria-labelledby="overview-active-projects"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="overview-active-projects"
          className="font-display text-[17px] font-bold tracking-tight text-[rgb(var(--fg-default))]"
        >
          Active projects
        </h2>
        {totalProjects > 0 ? (
          <Link
            href={`/dashboard/clients-projects/clients/${clientId}?tab=projects`}
            scroll={false}
            className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
          >
            See all →
          </Link>
        ) : null}
      </header>

      {projects.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          No active projects with this client right now.
        </p>
      ) : (
        <ul
          role="list"
          className="mt-4 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]"
        >
          {projects.slice(0, 4).map((p) => (
            <li key={p.id}>
              <ActiveProjectRow project={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActiveProjectRow({ project }: { project: Project }) {
  const pct = STAGE_PROGRESS[project.stage];
  const stageLabel = STAGE_LABEL[project.stage];
  const overdue = isOverdue(project);
  const overdueLabel = overdue ? formatOverdueLabel(project.nextSessionAt) : null;

  return (
    <Link
      href={`/dashboard/clients-projects/${project.id}`}
      className="flex items-center gap-4 py-3 transition-colors hover:bg-[rgb(var(--bg-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
    >
      <ProjectThumb title={project.title} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13.5px] font-bold text-[rgb(var(--fg-default))]">
            {project.title}
          </p>
          {overdue ? (
            <span className="pill pill-danger">Overdue</span>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <div
            aria-hidden
            className="h-[5px] flex-1 overflow-hidden rounded-full bg-[rgb(var(--bg-overlay))]"
          >
            <div
              className="h-full rounded-full bg-[rgb(var(--fg-default))]"
              style={{ width: `${pct.toString()}%` }}
            />
          </div>
          <p className="sk-num shrink-0 font-mono text-[11px] font-bold tabular-nums text-[rgb(var(--fg-muted))]">
            {pct.toString()}% · {stageLabel}
          </p>
        </div>
      </div>

      {overdueLabel ? (
        <p
          className="shrink-0 text-right text-[12.5px] font-bold sm:w-20"
          style={{ color: "rgb(var(--fg-danger))" }}
        >
          {overdueLabel}
        </p>
      ) : null}
    </Link>
  );
}

// 40px square thumb keyed off the project title — same gradient
// formula as the avatar so a project's marker stays stable across
// views. Slightly larger than the previous 36px to balance with the
// row's increased vertical rhythm.
function ProjectThumb({ title }: { title: string }) {
  const hue = simpleHue(title);
  return (
    <div
      aria-hidden
      className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)]"
      style={{
        background: `linear-gradient(135deg, oklch(0.58 0.16 ${hue.toString()}), oklch(0.4 0.14 ${((hue + 30) % 360).toString()}))`,
      }}
    />
  );
}

function simpleHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function isOverdue(p: Project): boolean {
  if (!p.nextSessionAt) return false;
  const t =
    p.nextSessionAt instanceof Date
      ? p.nextSessionAt.getTime()
      : new Date(p.nextSessionAt).getTime();
  return t < Date.now();
}

function formatOverdueLabel(raw: Date | string | null): string {
  if (!raw) return "";
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  const diffMs = Date.now() - t;
  const days = Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)));
  return `${days.toString()}d late`;
}

// ─── Recent activity ────────────────────────────────────────────────

type ActivityItem =
  | {
      kind: "comment";
      id: string;
      body: string;
      fromProducer: boolean;
      at: Date;
    }
  | {
      kind: "project-update";
      id: string;
      body: string;
      at: Date;
    };

function buildActivity(
  projects: Project[],
  comments: Comment[],
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const c of comments) {
    items.push({
      kind: "comment",
      id: `c-${c.id}`,
      body: c.body,
      fromProducer: c.fromProducer,
      at: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
    });
  }
  for (const p of projects) {
    const at =
      p.updatedAt instanceof Date ? p.updatedAt : new Date(p.updatedAt);
    items.push({
      kind: "project-update",
      id: `p-${p.id}`,
      body: `${STAGE_LABEL[p.stage]} — ${p.title}`,
      at,
    });
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, 6);
}

function RecentActivityCard({
  projects,
  comments,
  clientName,
}: {
  projects: Project[];
  comments: Comment[];
  clientName: string;
}) {
  const items = buildActivity(projects, comments);
  const clientInitials = producerInitials(clientName);
  return (
    <section
      aria-labelledby="overview-recent-activity"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="overview-recent-activity"
          className="font-display text-[17px] font-bold tracking-tight text-[rgb(var(--fg-default))]"
        >
          Recent activity
        </h2>
      </header>

      {items.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          Nothing yet — comments + stage updates will appear here.
        </p>
      ) : (
        <ul role="list" className="mt-4 flex flex-col gap-3">
          {items.map((it) =>
            it.kind === "comment" ? (
              <CommentBubbleRow
                key={it.id}
                body={it.body}
                fromProducer={it.fromProducer}
                at={it.at}
                clientInitials={clientInitials}
              />
            ) : (
              <ProjectUpdateRow key={it.id} body={it.body} at={it.at} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

// Producer messages right-aligned with a dark bubble + producer
// initials chip at the trailing edge. Client messages left-aligned
// with their initials avatar at the leading edge and a soft cream
// bubble. Mirrors a chat-thread feel without committing to a real
// inbox surface.
function CommentBubbleRow({
  body,
  fromProducer,
  at,
  clientInitials,
}: {
  body: string;
  fromProducer: boolean;
  at: Date;
  clientInitials: string;
}) {
  if (fromProducer) {
    return (
      <li className="flex items-start justify-end gap-2">
        <div className="flex max-w-[80%] flex-col items-end gap-1">
          <div className="rounded-[18px] rounded-br-sm bg-[rgb(var(--fg-default))] px-3.5 py-2 text-[13px] leading-snug text-[rgb(var(--bg-elevated))] shadow-sm">
            {body}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
            you · {formatRelativeTime(at)}
          </p>
        </div>
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[10.5px] font-bold text-[rgb(var(--bg-base))]"
        >
          GS
        </span>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-overlay))] text-[10.5px] font-bold text-[rgb(var(--fg-default))]"
      >
        {clientInitials}
      </span>
      <div className="flex max-w-[80%] flex-col items-start gap-1">
        <div className="rounded-[18px] rounded-bl-sm bg-[rgb(var(--bg-base))] px-3.5 py-2 text-[13px] leading-snug text-[rgb(var(--fg-default))] shadow-sm ring-1 ring-[rgb(var(--border-subtle))]">
          {body}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
          {formatRelativeTime(at)}
        </p>
      </div>
    </li>
  );
}

// Project stage updates render as a centered, thin timeline line so
// they read as ambient activity rather than conversation. Different
// affordance from comments stops the producer mistaking system events
// for messages from the client.
function ProjectUpdateRow({ body, at }: { body: string; at: Date }) {
  return (
    <li className="flex items-center justify-center gap-2 px-2 py-1 text-center">
      <span
        aria-hidden
        className="h-[1px] flex-1 bg-[rgb(var(--border-subtle))]"
      />
      <p className="text-[12px] text-[rgb(var(--fg-muted))]">
        <span className="font-mono uppercase tracking-[0.1em] text-[10px]">
          {formatRelativeTime(at)}
        </span>{" "}
        · {body}
      </p>
      <span
        aria-hidden
        className="h-[1px] flex-1 bg-[rgb(var(--border-subtle))]"
      />
    </li>
  );
}

// ─── Financial relationship ─────────────────────────────────────────

function FinancialRelationshipCard({
  paidCents,
  billedCents,
  owedCents,
  settledPct,
  currency,
}: {
  paidCents: number;
  billedCents: number;
  owedCents: number;
  settledPct: number;
  currency: string;
}) {
  return (
    <section
      aria-labelledby="overview-financial"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <h2
        id="overview-financial"
        className="font-display text-[17px] font-bold tracking-tight text-[rgb(var(--fg-default))]"
      >
        Financial relationship
      </h2>

      <p className="mt-4 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        Paid of billed
      </p>
      <p className="mt-1.5 font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]">
        <span className="sk-num font-mono tabular-nums">
          {formatMoney(paidCents, currency)}
        </span>
        <span className="text-[rgb(var(--fg-muted))]">
          {" "}
          /{" "}
          <span className="sk-num font-mono tabular-nums">
            {formatMoney(billedCents, currency)}
          </span>
        </span>
      </p>

      <div
        aria-hidden
        className="mt-4 h-2 overflow-hidden rounded-full bg-[rgb(var(--bg-overlay))]"
      >
        <div
          className="h-full rounded-full bg-[rgb(var(--brand-primary))]"
          style={{ width: `${settledPct.toString()}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11.5px]">
        <span className="text-[rgb(var(--fg-muted))]">
          {settledPct.toString()}% settled
        </span>
        {owedCents > 0 ? (
          <span
            className="sk-num font-mono font-bold tabular-nums"
            style={{ color: "rgb(var(--fg-danger))" }}
          >
            {formatMoney(owedCents, currency)} owed
          </span>
        ) : (
          <span className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-[rgb(var(--fg-success))]">
            All settled
          </span>
        )}
      </div>
    </section>
  );
}
