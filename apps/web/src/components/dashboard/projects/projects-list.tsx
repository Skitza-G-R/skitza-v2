"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Kanban-visible stages in the order they surface in the UI. Matches
// the ordering already used by project.listByStage on the server — we
// intentionally re-declare here rather than import, because the stage
// router lives in the server bundle and inferring the key-order from
// an object literal is fragile across TS configs. Seven stages; the
// terminal `payment_paused` / `cancelled` are intentionally excluded
// from this view (they have their own surfaces elsewhere).
const STAGE_ORDER = [
  "lead",
  "booked",
  "contract_sent",
  "in_production",
  "final_review",
  "paid",
  "archived",
] as const;
export type Stage = (typeof STAGE_ORDER)[number];

const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  booked: "Booked",
  contract_sent: "Contract sent",
  in_production: "In production",
  final_review: "Final review",
  paid: "Paid",
  archived: "Archived",
};

// Per-stage tint. We roll a small on-the-fly palette keyed to the
// design tokens rather than reaching into the shared Badge variants
// — the seven-bucket breakdown is specific to this surface and a
// proper StageBadge primitive can come later if other screens need
// one. Each entry pairs a foreground/background/border triple that
// all compose from CSS vars (zero hex), so theme switches just work.
const STAGE_TONE: Record<
  Stage,
  { text: string; bg: string; border: string }
> = {
  lead: {
    text: "rgb(var(--fg-secondary))",
    bg: "rgb(var(--bg-elevated))",
    border: "rgb(var(--border-subtle))",
  },
  booked: {
    text: "rgb(var(--brand-primary))",
    bg: "rgb(var(--brand-primary) / 0.12)",
    border: "rgb(var(--brand-primary) / 0.35)",
  },
  contract_sent: {
    text: "rgb(var(--brand-accent))",
    bg: "rgb(var(--brand-accent) / 0.12)",
    border: "rgb(var(--brand-accent) / 0.35)",
  },
  in_production: {
    text: "rgb(var(--brand-primary))",
    bg: "rgb(var(--brand-primary) / 0.08)",
    border: "rgb(var(--brand-primary) / 0.25)",
  },
  final_review: {
    text: "rgb(var(--fg-warning))",
    bg: "rgb(var(--fg-warning) / 0.12)",
    border: "rgb(var(--fg-warning) / 0.35)",
  },
  paid: {
    text: "rgb(var(--brand-primary))",
    bg: "rgb(var(--brand-primary) / 0.15)",
    border: "rgb(var(--brand-primary) / 0.45)",
  },
  archived: {
    text: "rgb(var(--fg-muted))",
    bg: "rgb(var(--bg-sunken))",
    border: "rgb(var(--border-subtle))",
  },
};

// Minimum row shape we render. Mirrors the drizzle projects row
// subset we actually use — date timestamps cross the RSC → client
// boundary as ISO strings (the page serializes them). Keeping this
// intentionally tight means we don't ship fields like shareTokenHash
// or stripe ids to the client.
export type ProjectRow = {
  id: string;
  title: string;
  artistName: string;
  stage: Stage;
  updatedAtIso: string;
};

export type GroupedProjects = Record<Stage, ProjectRow[]>;

export function ProjectsList({
  grouped,
  activeStage,
}: {
  grouped: GroupedProjects;
  activeStage: Stage | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Total across buckets — drives the top-level empty state decision.
  const totalCount = STAGE_ORDER.reduce(
    (n, s) => n + grouped[s].length,
    0,
  );

  const selectStage = (next: Stage | null) => {
    const query = next ? `?stage=${next}` : "";
    startTransition(() => {
      router.replace(`/dashboard/projects${query}`, { scroll: false });
    });
  };

  // Nothing across any stage — offer the lead-gen funnel CTA. Magic
  // links are the upstream source of Projects, so we nudge the producer
  // back toward creating one rather than leaving them staring at a
  // blank list.
  if (totalCount === 0) {
    return (
      <div className="mt-10 flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]">
          <FolderIcon />
        </div>
        <h3 className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]">
          No projects yet
        </h3>
        <p className="mt-2 max-w-md text-sm text-[rgb(var(--fg-secondary))]">
          Projects appear here once you create one — a shareable link is generated
          automatically for the client.
        </p>
        <Link
          href="/dashboard/projects/new"
          className="mt-6 inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          Create a project
        </Link>
      </div>
    );
  }

  // Rows to render below the chip bar. When no stage filter is set we
  // render every bucket with its heading; when one is set we flatten
  // to just that bucket's rows (no heading) — the chip itself serves
  // as the header at that point.
  const stagesToRender: readonly Stage[] = activeStage ? [activeStage] : STAGE_ORDER;

  return (
    <div className="mt-6 flex flex-col gap-6">
      <StageChipBar
        grouped={grouped}
        activeStage={activeStage}
        disabled={isPending}
        onSelect={selectStage}
      />

      <div className="flex flex-col gap-8">
        {stagesToRender.map((stage) => {
          const rows = grouped[stage];
          // If the producer deep-linked to an empty stage, show the
          // narrower "nothing in this stage" prompt. Otherwise when
          // we're rendering "all" we just skip empty buckets so the
          // page stays tight rather than padding out seven headers.
          if (rows.length === 0) {
            if (activeStage) {
              return <StageEmpty key={stage} />;
            }
            return null;
          }

          return (
            <section key={stage} aria-labelledby={`stage-${stage}-heading`}>
              {!activeStage ? (
                <h2
                  id={`stage-${stage}-heading`}
                  className="mb-3 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
                >
                  {STAGE_LABEL[stage]}{" "}
                  <span className="sk-num text-[rgb(var(--fg-secondary))]">
                    · {rows.length.toString()}
                  </span>
                </h2>
              ) : null}

              <ul
                role="list"
                className="divide-y divide-[rgb(var(--border-subtle))] overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
              >
                {rows.map((row) => (
                  <ProjectRowItem key={row.id} row={row} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ─── Chip bar ────────────────────────────────────────────────────────

function StageChipBar({
  grouped,
  activeStage,
  disabled,
  onSelect,
}: {
  grouped: GroupedProjects;
  activeStage: Stage | null;
  disabled: boolean;
  onSelect: (stage: Stage | null) => void;
}) {
  const totalCount = STAGE_ORDER.reduce((n, s) => n + grouped[s].length, 0);

  return (
    // Horizontal scroll on mobile — eight chips (All + 7 stages) at
    // 360px width would otherwise wrap-cram. The rail stays single-row
    // and swipable on narrow screens, naturally wraps on desktop.
    <nav aria-label="Filter by stage" className="-mx-4 sm:mx-0">
      <div className="flex gap-2 overflow-x-auto px-4 pb-1 sm:flex-wrap sm:overflow-visible sm:px-0">
        <Chip
          label="All"
          count={totalCount}
          active={activeStage === null}
          disabled={disabled}
          onClick={() => {
            onSelect(null);
          }}
        />
        {STAGE_ORDER.map((stage) => (
          <Chip
            key={stage}
            label={STAGE_LABEL[stage]}
            count={grouped[stage].length}
            active={activeStage === stage}
            disabled={disabled}
            onClick={() => {
              onSelect(stage);
            }}
          />
        ))}
      </div>
    </nav>
  );
}

function Chip({
  label,
  count,
  active,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        active
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <span
        className={[
          "sk-num font-mono text-[0.66rem]",
          active ? "text-[rgb(var(--brand-primary))]" : "text-[rgb(var(--fg-muted))]",
        ].join(" ")}
      >
        {count.toString()}
      </span>
    </button>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────

function ProjectRowItem({ row }: { row: ProjectRow }) {
  const tone = STAGE_TONE[row.stage];
  return (
    <li>
      <Link
        href={`/dashboard/projects/${row.id}`}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[rgb(var(--bg-sunken))]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
              {row.title}
            </p>
            <p className="sk-num shrink-0 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
              {formatRelativeTime(new Date(row.updatedAtIso))}
            </p>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p className="truncate text-xs text-[rgb(var(--fg-secondary))]">
              {row.artistName}
            </p>
            <span
              className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-medium uppercase tracking-[0.1em]"
              style={{
                color: tone.text,
                backgroundColor: tone.bg,
                borderColor: tone.border,
              }}
            >
              {STAGE_LABEL[row.stage]}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

// ─── Sub-states ──────────────────────────────────────────────────────

function StageEmpty() {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center">
      <p className="text-sm text-[rgb(var(--fg-secondary))]">
        No projects in this stage.{" "}
        <Link
          href="/dashboard/projects"
          className="text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
          scroll={false}
        >
          Show all
        </Link>
      </p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function FolderIcon() {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M7 5V3h6v2" />
      <path d="M2.5 10h19" />
    </svg>
  );
}

// Compact relative-time for updatedAt. "3d ago" at a glance — past
// only on this surface (projects don't surface future-dated
// timestamps). Minutes/hours/days thresholds match the Today
// inbox's helper so the two screens read consistently side by side.
function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min.toString()}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr.toString()}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day.toString()}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
