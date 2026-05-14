import Link from "next/link";

import { formatMoney } from "~/lib/format/money";
import { STAGE_LABEL, type Stage } from "~/lib/projects/stages";

// Projects panel — table view of every project this client has,
// matching the founder's HTML mockup: "PROJECT / STAGE | PROGRESS |
// BALANCE | DEADLINE" columns. Mobile collapses to a two-row card per
// project so the columns don't crush.
//
// Stage→% mapping mirrors the overview panel so the bar visuals are
// consistent across surfaces. Balance is the per-project
// outstandingCents (already rolled up in `clientContacts.detail`);
// "—" rendered when zero so paid/archived rows stay readable.
//
// Sort: server already returns desc(updatedAt). We render in that
// order, which puts the most-recently-touched project on top — the
// same heuristic used elsewhere in the dashboard.

type Project = {
  id: string;
  title: string;
  stage: Stage;
  priceCents: number;
  currency: string | null;
  outstandingCents: number;
  finalPaid: boolean;
  nextSessionAt: Date | string | null;
};

const STAGE_PROGRESS: Record<Stage, number> = {
  lead: 10,
  booked: 25,
  in_production: 65,
  final_review: 85,
  paid: 100,
  archived: 100,
};

export function ClientProjectsPanel({
  projects,
  currency,
}: {
  projects: Project[];
  currency: string;
}) {
  if (projects.length === 0) {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-8 text-center text-[13px] text-[rgb(var(--fg-muted))]"
      >
        No projects with this client yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      {/* Column headers — desktop only. Mobile uses inline labels per
          card row so the columns aren't required. */}
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 border-b border-[rgb(var(--border-subtle))] px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] sm:grid">
        <span>Project / Stage</span>
        <span>Progress</span>
        <span className="text-right">Balance</span>
        <span className="text-right">Deadline</span>
      </div>

      <ul role="list" className="divide-y divide-[rgb(var(--border-subtle))]">
        {projects.map((p) => (
          <li key={p.id}>
            <ProjectRow project={p} currency={currency} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectRow({
  project,
  currency,
}: {
  project: Project;
  currency: string;
}) {
  const pct = STAGE_PROGRESS[project.stage];
  const balance = project.outstandingCents;
  const balanceCurrency = project.currency ?? currency;
  const deadline = formatDeadline(project.nextSessionAt);
  const overdue = deadline?.tone === "danger";

  return (
    <Link
      href={`/dashboard/clients-projects/${project.id}`}
      className="grid grid-cols-1 gap-3 px-4 py-3 transition-colors hover:bg-[rgb(var(--bg-overlay))] sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
    >
      {/* Project + stage */}
      <div className="flex items-center gap-3">
        <ProjectThumb title={project.title} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13.5px] font-bold text-[rgb(var(--fg-default))]">
              {project.title}
            </p>
            {overdue ? (
              <span className="pill pill-danger">Overdue</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
            {STAGE_LABEL[project.stage]}
          </p>
        </div>
      </div>

      {/* Progress */}
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

      {/* Balance */}
      <p
        className="sk-num font-mono text-[13px] font-bold tabular-nums sm:text-right"
        style={{
          color:
            balance > 0
              ? "rgb(var(--fg-danger))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {balance > 0 ? formatMoney(balance, balanceCurrency) : "—"}
      </p>

      {/* Deadline */}
      <p
        className="text-[12.5px] font-bold sm:text-right"
        style={{
          color:
            deadline?.tone === "danger"
              ? "rgb(var(--fg-danger))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {deadline?.label ?? "—"}
      </p>
    </Link>
  );
}

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

function formatDeadline(
  raw: Date | string | null,
): { label: string; tone: "danger" | "default" } | null {
  if (!raw) return null;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  const diffMs = t - Date.now();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffMs < 0) {
    const overdueDays = Math.max(1, Math.abs(days));
    return { label: `${overdueDays.toString()}d late`, tone: "danger" };
  }
  if (days === 0) return { label: "Today", tone: "danger" };
  if (days === 1) return { label: "Tomorrow", tone: "default" };
  return { label: `${days.toString()}d`, tone: "default" };
}
