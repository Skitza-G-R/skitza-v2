// 4-tile status strip rendered between the gradient hero and the
// pill-tab strip. At-a-glance project state: stage, progress, next
// charge, outstanding balance. Mirrors the reference design's "stat
// row" — a compact panel that lets the producer eyeball where the
// project sits without drilling into a tab.
//
// Server component (no `"use client"`): everything here is pure
// formatting. Avoids unnecessary hydration cost for a panel that
// doesn't have interactive elements.

interface ProjectStatusStripProps {
  // Higher-level state ("Drafting" / "In production" / "Done"). Pre-
  // computed by the orchestrator from the stage taxonomy so this
  // component doesn't need to import the state machine.
  stateLabel: string;
  // Fine-grained stage when it differs from the state label (e.g.
  // state="Drafting" + stage="Brief sent"). Hidden when identical.
  stageDetail?: string;
  // 0..100. Derived from the timeline helper's "done" step count.
  progressPercent: number;
  // Next-charge timestamp for split/monthly plans, null for full-pay
  // or settled projects. Tile renders "—" when null.
  nextChargeAt: Date | null;
  outstandingCents: number;
  currency: string;
}

export function ProjectStatusStrip({
  stateLabel,
  stageDetail,
  progressPercent,
  nextChargeAt,
  outstandingCents,
  currency,
}: ProjectStatusStripProps) {
  const isOutstanding = outstandingCents > 0;
  const outstandingDisplay = isOutstanding
    ? formatMoney(outstandingCents, currency)
    : "Settled";

  // Next-charge urgency colors mirror the reference: red <0d, amber
  // <=7d, neutral otherwise. We compute days-until in producer-local
  // time to avoid timezone-shift surprises around midnight.
  const nextChargeDays = nextChargeAt ? daysUntil(nextChargeAt) : null;
  const nextChargeAccent =
    nextChargeDays === null
      ? null
      : nextChargeDays < 0
        ? "danger"
        : nextChargeDays <= 7
          ? "warning"
          : null;
  const nextChargeDisplay =
    nextChargeAt === null
      ? "—"
      : nextChargeDays !== null && nextChargeDays < 0
        ? `${String(Math.abs(nextChargeDays))}d late`
        : fmtShortDate(nextChargeAt);

  // Progress is clamped 0..100 in case a malformed input slips in
  // (computeTimeline guarantees the source range, but defense-in-depth
  // here means the inline width never goes negative or overflows).
  const clampedProgress = Math.min(100, Math.max(0, progressPercent));

  return (
    <div
      role="group"
      aria-label="Project at a glance"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      <StatTile label="Stage">
        <div className="text-base font-bold leading-tight tracking-tight">
          {stateLabel}
        </div>
        {stageDetail && stageDetail !== stateLabel ? (
          <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
            {stageDetail}
          </div>
        ) : null}
      </StatTile>

      <StatTile label="Progress">
        <div className="font-mono text-base font-bold tabular tracking-tight">
          {String(Math.round(clampedProgress))}%
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgb(var(--border-subtle))]">
          <div
            className="h-full rounded-full bg-[rgb(var(--fg-primary))]"
            style={{ width: `${String(clampedProgress)}%` }}
          />
        </div>
      </StatTile>

      <StatTile label="Next charge" accent={nextChargeAccent}>
        <div
          className={[
            "font-mono text-base font-bold tabular tracking-tight",
            nextChargeAccent === "danger"
              ? "text-[rgb(var(--fg-danger))]"
              : nextChargeAccent === "warning"
                ? "text-[rgb(var(--fg-warning))]"
                : "",
          ].join(" ")}
        >
          {nextChargeDisplay}
        </div>
      </StatTile>

      <StatTile label="Outstanding" accent={isOutstanding ? "danger" : "success"}>
        <div
          className={[
            "font-mono text-base font-bold tabular tracking-tight",
            isOutstanding
              ? "text-[rgb(var(--fg-danger))]"
              : "text-[rgb(var(--fg-success))]",
          ].join(" ")}
        >
          {outstandingDisplay}
        </div>
      </StatTile>
    </div>
  );
}

// ─── StatTile ─────────────────────────────────────────────────────────

type Accent = "danger" | "warning" | "success" | null;

function StatTile({
  label,
  accent = null,
  children,
}: {
  label: string;
  accent?: Accent;
  children: React.ReactNode;
}) {
  // Tile background tints when an accent is set — keeps the most
  // urgent tiles (overdue payment, settled balance) visually distinct
  // without relying on color alone.
  const tone =
    accent === "danger"
      ? "bg-[rgb(var(--fg-danger)/0.06)] border-[rgb(var(--fg-danger)/0.2)]"
      : accent === "warning"
        ? "bg-[rgb(var(--fg-warning)/0.06)] border-[rgb(var(--fg-warning)/0.2)]"
        : accent === "success"
          ? "bg-[rgb(var(--fg-success)/0.06)] border-[rgb(var(--fg-success)/0.2)]"
          : "bg-[rgb(var(--bg-elevated))] border-[rgb(var(--border-subtle))]";
  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border px-3.5 py-3",
        tone,
      ].join(" ")}
    >
      <div className="label-tiny mb-1.5">{label}</div>
      {children}
    </div>
  );
}

// ─── Local helpers ────────────────────────────────────────────────────

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtShortDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d);
}

// Whole-day delta from "now" to a target Date, computed in producer-
// local time. Negative when target is in the past. Used by the Next
// charge tile to colorize overdue / imminent vs. comfortable.
function daysUntil(target: Date): number {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();
  return Math.round((startOfTarget - startOfToday) / 86_400_000);
}
