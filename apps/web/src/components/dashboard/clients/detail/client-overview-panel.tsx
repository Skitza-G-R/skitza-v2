import Link from "next/link";

import { formatMoney } from "~/lib/format/money";
import { STAGE_LABEL, type Stage } from "~/lib/projects/stages";
import { formatRelativeTime } from "~/lib/time/relative";

// Overview panel — landing tab on the client detail page.
//
// Two-column layout matching the founder's HTML mockup: the left rail
// holds "Active projects" + "Recent activity" (the day-to-day work the
// producer cares about), and the right rail holds "Financial
// relationship" (a glanceable money summary).
//
// Per direction (2026-05-06): the "Send payment reminder" CTA was
// dropped because the underlying mutation doesn't exist yet — shipping
// a button that no-ops would lie to the producer. The financial card
// stays informational; the producer can act from a project page.
//
// Active-projects rows show the stage as a soft progress bar (each
// stage maps to a deterministic % so the visual matches the design's
// "65% · mixing" treatment). Stage→% is a presentation concern, not a
// product invariant — adjusting it here is safe.

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
  projects,
  comments,
  stats,
  currency,
}: {
  clientId: string;
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
        <RecentActivityCard projects={projects} comments={comments} />
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
          className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
        >
          Active projects
        </h2>
        {totalProjects > 0 ? (
          <Link
            href={`/dashboard/clients-projects/clients/${clientId}?tab=projects`}
            scroll={false}
            className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
          >
            See all
          </Link>
        ) : null}
      </header>

      {projects.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          No active projects with this client right now.
        </p>
      ) : (
        <ul role="list" className="mt-4 flex flex-col gap-2">
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
      className="sk-press flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-3 transition-colors hover:border-[rgb(var(--border-strong))] sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex shrink-0 items-center gap-3 sm:w-44">
        <ProjectThumb title={project.title} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold text-[rgb(var(--fg-default))]">
            {project.title}
          </p>
          {overdue ? (
            <span className="pill pill-danger mt-1 inline-flex">Overdue</span>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgb(var(--bg-overlay))]"
          >
            <div
              className="h-full rounded-full bg-[rgb(var(--fg-default))]"
              style={{ width: `${pct.toString()}%` }}
            />
          </div>
          <p className="sk-num shrink-0 font-mono text-[11.5px] font-bold tabular-nums text-[rgb(var(--fg-muted))]">
            {pct.toString()}%
          </p>
        </div>
        <p className="mt-1 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
          {stageLabel}
        </p>
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

// 36px square thumb keyed off the project title — same hue formula as
// the avatar so a project's marker stays stable across views.
function ProjectThumb({ title }: { title: string }) {
  const hue = simpleHue(title);
  return (
    <div
      aria-hidden
      className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)]"
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

type ActivityItem = {
  id: string;
  kind: "comment" | "project-update";
  body: string;
  who: string;
  at: Date;
};

function buildActivity(
  projects: Project[],
  comments: Comment[],
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const c of comments) {
    items.push({
      id: `c-${c.id}`,
      kind: "comment",
      body: c.body,
      who: c.fromProducer ? "you" : "them",
      at: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
    });
  }
  for (const p of projects) {
    const at =
      p.updatedAt instanceof Date ? p.updatedAt : new Date(p.updatedAt);
    items.push({
      id: `p-${p.id}`,
      kind: "project-update",
      body: `${STAGE_LABEL[p.stage]} — ${p.title}`,
      who: "system",
      at,
    });
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, 6);
}

function RecentActivityCard({
  projects,
  comments,
}: {
  projects: Project[];
  comments: Comment[];
}) {
  const items = buildActivity(projects, comments);
  return (
    <section
      aria-labelledby="overview-recent-activity"
      className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5"
    >
      <header className="flex items-center justify-between gap-3">
        <h2
          id="overview-recent-activity"
          className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
        >
          Recent activity
        </h2>
      </header>

      {items.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-6 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          Nothing yet — activity from track comments and stage changes will land here.
        </p>
      ) : (
        <ul role="list" className="mt-4 flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3">
              <ActivityDot kind={it.kind} who={it.who} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-[rgb(var(--fg-default))]">
                  {it.body}
                </p>
                <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[rgb(var(--fg-muted))]">
                  {formatRelativeTime(it.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityDot({
  kind,
  who,
}: {
  kind: ActivityItem["kind"];
  who: string;
}) {
  if (kind === "comment") {
    const tone =
      who === "you" ? "rgb(var(--brand-primary))" : "rgb(var(--fg-muted))";
    return (
      <span
        aria-hidden
        className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: tone }}
      >
        {who === "you" ? "GS" : "·"}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="mt-2 inline-block h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--fg-muted))]"
    />
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
        className="font-display text-base font-bold tracking-tight text-[rgb(var(--fg-default))]"
      >
        Financial relationship
      </h2>

      <p className="mt-4 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        Paid of billed
      </p>
      <p className="mt-1 font-display text-3xl font-extrabold leading-tight tracking-tight text-[rgb(var(--fg-default))]">
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
