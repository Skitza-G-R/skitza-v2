// 4-tile status strip rendered between the hero and the sub-tabs.
// Replaces the prior "what's the state of this project at a glance"
// signals that used to live inside ProjectHeader. Tiles:
//   1. Status      — state pill (Live / Done / Archived)
//   2. Progress    — % complete + slim progress rail
//   3. Deadline    — next session date + days-until, color-graded
//   4. Outstanding — owed amount, color-graded danger when > 0
//
// All four pull from props supplied by the page; no fetching here so
// this is safe to render on the server (it's a pure presentation
// component).

import { STAGE_LABEL, type Stage } from "~/lib/projects/stages";
import { stageToState, STATE_TONE } from "~/lib/projects/states";

const STAGE_PROGRESS: Record<Stage, number> = {
  lead: 8,
  booked: 22,
  contract_sent: 38,
  in_production: 58,
  final_review: 78,
  paid: 100,
  archived: 100,
  payment_paused: 50,
  cancelled: 0,
};

export function ProjectStatStrip({
  stage,
  nextSessionAt,
  outstandingCents,
  currency,
}: {
  stage: Stage;
  nextSessionAt: Date | null;
  outstandingCents: number;
  currency: string;
}) {
  const state = stageToState(stage);
  const tone = STATE_TONE[state];
  const progress = STAGE_PROGRESS[stage];
  const deadline = formatDeadline(nextSessionAt);
  const owed = outstandingCents;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {/* Status */}
      <Tile label="Status">
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.1em]"
          style={{
            color: tone.text,
            backgroundColor: tone.bg,
            borderColor: tone.border,
          }}
        >
          {STAGE_LABEL[stage]}
        </span>
      </Tile>

      {/* Progress */}
      <Tile label="Progress">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-base font-extrabold tabular-nums">
            {progress.toString()}
            <span className="text-xs font-bold text-[rgb(var(--fg-muted))]">%</span>
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgb(var(--border-subtle))]">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{
              width: `${progress.toString()}%`,
              background:
                progress === 100
                  ? "rgb(var(--fg-success))"
                  : "rgb(var(--fg-primary))",
            }}
          />
        </div>
      </Tile>

      {/* Deadline */}
      <Tile label="Deadline" tone={deadline.tone}>
        <span className="font-mono text-base font-extrabold tabular-nums">
          {deadline.label}
        </span>
        {deadline.subLabel ? (
          <span className="mt-0.5 block text-[0.62rem] text-[rgb(var(--fg-muted))]">
            {deadline.subLabel}
          </span>
        ) : null}
      </Tile>

      {/* Outstanding */}
      <Tile
        label="Outstanding"
        tone={owed > 0 ? "danger" : "success"}
      >
        <span className="font-mono text-base font-extrabold tabular-nums">
          {owed > 0 ? formatMoney(owed, currency) : "Settled"}
        </span>
      </Tile>
    </div>
  );
}

function Tile({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const palette = TONE_PALETTE[tone];
  return (
    <div
      className="rounded-[var(--radius-md)] border p-3"
      style={{
        backgroundColor: palette.bg,
        borderColor: palette.border,
        color: palette.text,
      }}
    >
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <div className="mt-1.5 leading-none">{children}</div>
    </div>
  );
}

const TONE_PALETTE: Record<
  "default" | "danger" | "warning" | "success",
  { bg: string; border: string; text: string }
> = {
  default: {
    bg: "rgb(var(--bg-elevated))",
    border: "rgb(var(--border-subtle))",
    text: "rgb(var(--fg-primary))",
  },
  danger: {
    bg: "rgb(var(--fg-danger) / 0.06)",
    border: "rgb(var(--fg-danger) / 0.22)",
    text: "rgb(var(--fg-danger))",
  },
  warning: {
    bg: "rgb(var(--fg-warning) / 0.08)",
    border: "rgb(var(--fg-warning) / 0.22)",
    text: "rgb(var(--fg-warning))",
  },
  success: {
    bg: "rgb(var(--fg-success) / 0.06)",
    border: "rgb(var(--fg-success) / 0.22)",
    text: "rgb(var(--fg-success))",
  },
};

type DeadlineTone = "default" | "danger" | "warning" | "success";

function formatDeadline(next: Date | null): {
  label: string;
  subLabel: string;
  tone: DeadlineTone;
} {
  if (!next) {
    return { label: "—", subLabel: "No session booked", tone: "default" };
  }
  const now = Date.now();
  const ts = next.getTime();
  const days = Math.round((ts - now) / (24 * 60 * 60 * 1000));
  if (days < 0) {
    return {
      label: `${Math.abs(days).toString()}d late`,
      subLabel: "Session overdue",
      tone: "danger",
    };
  }
  if (days === 0) {
    return { label: "Today", subLabel: "Session today", tone: "warning" };
  }
  if (days <= 7) {
    return {
      label: `${days.toString()}d`,
      subLabel: "Until next session",
      tone: "warning",
    };
  }
  return {
    label: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(next),
    subLabel: "Next session",
    tone: "default",
  };
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
