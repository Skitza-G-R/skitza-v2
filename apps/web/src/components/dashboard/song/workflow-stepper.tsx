import { Check } from "lucide-react";
import type { CSSProperties } from "react";

import {
  WORKFLOW_STAGES,
  stageLabel,
  stageOrder,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";

// WorkflowStepper — 5-stage horizontal stepper for the Song Space's
// Overview tab (DESIGN.md §5.8, BUILD-NOTES §6.5).
//
// 5 stages — NOT 6 (Phase 0 decision: Gili dropped "Review" + "Delivery"
// from the prototype's stepper). Steps come from WORKFLOW_STAGES:
//
//   Brief & intake → Production → Mixing → Mastering → Done
//
// Layout:
//   - Outer grid: `repeat(5, 1fr)`. Each cell holds one step (dot +
//     label + sub-label, stacked vertically, all centered).
//   - Connector line sits absolutely behind the dots, spanning from the
//     first dot's center to the last dot's center. Base color uses
//     --border-subtle; an amber-to-green fill grows up to the current
//     stage, width driven by `--wf-fill` (inline CSS variable).
//
// `--wf-fill` formula:
//   const fillPct = stageOrder(current) / (WORKFLOW_STAGES.length - 1) * 100;
//   // 0 → 0%, 1 → 25%, 2 → 50%, 3 → 75%, 4 → 100%
//
// Visual states per step:
//   - todo: grey dot (--border-subtle), grey number
//   - done: green dot (--fg-success), white check
//   - now:  amber dot (--brand-primary), outer ring, soft pulse
//
// The amber pulse is decorative. Wrapped in a CSS @media gate via the
// inline <style> below so it's automatically suppressed for users
// with prefers-reduced-motion: reduce. Also exposes the Tailwind
// motion-reduce:animate-none variant for belt-and-suspenders.

interface WorkflowStepperProps {
  current: WorkflowStage;
}

type StepState = "todo" | "done" | "now";

function stateFor(currentIdx: number, stepIdx: number): StepState {
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "now";
  return "todo";
}

export function WorkflowStepper({ current }: WorkflowStepperProps) {
  const total = WORKFLOW_STAGES.length;
  const currentIdx = stageOrder(current);
  // WORKFLOW_STAGES has 5 entries (Phase 0 decision — see the
  // `~/lib/clients/workflow-stage` source), so `total - 1` is safely
  // > 0. We keep the divisor expressed as `total - 1` so the formula
  // stays correct if a future migration adds/removes a stage.
  const fillPct = (currentIdx / (total - 1)) * 100;

  // Connector + fill are wired through this --wf-fill CSS variable —
  // the line's ::after width reads it so we only need to set one value.
  const connectorVars: CSSProperties = {
    ["--wf-fill" as string]: `${String(fillPct)}%`,
  };

  return (
    <div
      className="relative"
      aria-label="Workflow progress"
      role="group"
    >
      {/* Local <style> for the wfpulse keyframe + the connector fill
          width. Lives inline because Tailwind's animate-* utilities can't
          express a keyframe without a `tailwind.config.ts` patch — and we
          want to keep this component self-contained. The pulse is only
          applied inside the prefers-reduced-motion: no-preference gate. */}
      <style>{`
        @keyframes wfpulse {
          0%, 100% { box-shadow: 0 0 0 4px rgb(var(--brand-primary)/0.20); transform: scale(1); }
          50%      { box-shadow: 0 0 0 6px rgb(var(--brand-primary)/0.10); transform: scale(1.05); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .wf-now-pulse { animation: wfpulse 1.8s ease-in-out infinite; }
        }
      `}</style>

      {/* Connector base + fill — absolutely positioned behind the dots.
          Insets of 10% on each side place the line endpoints at the
          centers of the first + last dots (1/(2*5) = 10% per side). */}
      <div
        className="pointer-events-none absolute left-[10%] right-[10%] top-3.5 h-[2px]"
        style={
          { background: "rgb(var(--border-subtle))" } satisfies CSSProperties
        }
        aria-hidden
      >
        <div
          className="h-full"
          style={{
            width: "var(--wf-fill)",
            background:
              "linear-gradient(90deg, rgb(var(--brand-primary)) 0%, rgb(var(--fg-success)) 100%)",
            ...connectorVars,
          }}
        />
      </div>

      {/* 5-column grid of steps */}
      <ol
        className="relative grid"
        style={{ gridTemplateColumns: "repeat(5, 1fr)" }}
      >
        {WORKFLOW_STAGES.map((stage, i) => {
          const state = stateFor(currentIdx, i);
          const isDone = state === "done";
          const isNow = state === "now";

          // Dot styles per state.
          let dotBg: string;
          let dotColor: string;
          let dotBorder: string;
          let pulseClass = "";
          if (isDone) {
            dotBg = "rgb(var(--fg-success))";
            dotColor = "rgb(var(--bg-sidebar))";
            dotBorder = "rgb(var(--fg-success))";
          } else if (isNow) {
            dotBg = "rgb(var(--brand-primary))";
            dotColor = "rgb(var(--bg-sidebar))";
            dotBorder = "rgb(var(--brand-primary))";
            pulseClass = "wf-now-pulse motion-reduce:animate-none";
          } else {
            dotBg = "rgb(var(--bg-elevated))";
            dotColor = "rgb(var(--fg-muted))";
            dotBorder = "rgb(var(--border-subtle))";
          }

          const labelColor = isDone
            ? "rgb(var(--fg-success))"
            : isNow
              ? "rgb(var(--brand-primary))"
              : "rgb(var(--fg-default))";

          return (
            <li
              key={stage.key}
              data-state={state}
              // `aria-current="step"` flags the active stage for SR
              // users — the visual amber dot + ring on its own carries
              // no semantic meaning. We attach it on the <li> rather
              // than the dot because the dot itself is decorative
              // (`aria-hidden`).
              aria-current={isNow ? "step" : undefined}
              className="flex flex-col items-center text-center"
            >
              <span
                className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[12px] font-bold tabular-nums ${pulseClass}`}
                style={{
                  background: dotBg,
                  borderColor: dotBorder,
                  color: dotColor,
                }}
                aria-hidden
              >
                {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span
                className="mt-2 text-[11px] font-semibold leading-tight"
                style={{ color: labelColor }}
              >
                {stageLabel(stage.key)}
                {/* Visually-hidden completion suffix — turns "Mixing"
                    into "Mixing (completed)" when read by a screen
                    reader, mirroring the green checkmark visible
                    sighted users get. */}
                {isDone ? <span className="sr-only"> (completed)</span> : null}
              </span>
              <span
                className="mt-0.5 text-[10px] leading-tight"
                style={{ color: "rgb(var(--fg-muted))" }}
              >
                {stage.sub}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
