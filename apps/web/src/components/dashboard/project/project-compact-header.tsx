"use client";

import { AlertCircle, CalendarDays, ChevronRight, UserRound } from "lucide-react";

import { stageLabel, type WorkflowStage } from "~/lib/clients/workflow-stage";

import { ProjectQuickActions } from "./project-quick-actions";

export interface ProjectPaymentAttention {
  needsReviewPurchaseCount: number;
  dueOrOverduePurchaseCount: number;
}

interface ProjectCompactHeaderProps {
  name: string;
  clientName: string;
  workflowStage: WorkflowStage;
  deadline: string;
  isOverdue: boolean;
  paymentAttention: ProjectPaymentAttention | null;
  canAddSong: boolean;
  blockedReason: string;
  onOpenPayments: () => void;
  onAddSong: () => void;
}

function paymentAttentionLabel(attention: ProjectPaymentAttention): string {
  const parts: string[] = [];
  if (attention.needsReviewPurchaseCount > 0) {
    parts.push(
      `${String(attention.needsReviewPurchaseCount)} purchase${
        attention.needsReviewPurchaseCount === 1 ? "" : "s"
      } awaiting proof review`,
    );
  }
  if (attention.dueOrOverduePurchaseCount > 0) {
    parts.push(
      `${String(attention.dueOrOverduePurchaseCount)} purchase${
        attention.dueOrOverduePurchaseCount === 1 ? "" : "s"
      } with due or overdue payments`,
    );
  }
  return parts.join(" · ");
}

export function ProjectCompactHeader({
  name,
  clientName,
  workflowStage,
  deadline,
  isOverdue,
  paymentAttention,
  canAddSong,
  blockedReason,
  onOpenPayments,
  onAddSong,
}: ProjectCompactHeaderProps) {
  return (
    <header className="rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[0_10px_30px_-24px_rgb(var(--fg-default)/0.28)] sm:px-5 sm:py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display truncate text-[clamp(1.65rem,5vw,2rem)] leading-none font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            {name}
          </h1>

          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
            <span
              aria-label={`Client ${clientName}`}
              className="inline-flex min-w-0 items-center gap-1.5"
            >
              <UserRound size={13} strokeWidth={2.1} aria-hidden />
              <span className="truncate">{clientName}</span>
            </span>
            <span
              aria-label={`Current stage ${stageLabel(workflowStage)}`}
              className="inline-flex items-center gap-1.5"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]"
              />
              {stageLabel(workflowStage)}
            </span>
            <span
              aria-label={`Deadline ${deadline}`}
              className={[
                "inline-flex items-center gap-1.5",
                isOverdue ? "font-semibold text-[rgb(var(--fg-danger-text))]" : "",
              ].join(" ")}
            >
              <CalendarDays size={13} strokeWidth={2.1} aria-hidden />
              {deadline}
            </span>
          </div>
        </div>

        <ProjectQuickActions
          projectName={name}
          canAddSong={canAddSong}
          blockedReason={blockedReason}
          onAddSong={onAddSong}
        />
      </div>

      {paymentAttention ? (
        <button
          type="button"
          onClick={onOpenPayments}
          className="sk-press mt-4 flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.1)] px-3.5 text-left text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          <AlertCircle
            size={17}
            strokeWidth={2.2}
            className="shrink-0 text-[rgb(var(--brand-primary-dark))]"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-bold">Payment needs attention</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-[rgb(var(--fg-muted))]">
              {paymentAttentionLabel(paymentAttention)}
            </span>
          </span>
          <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
        </button>
      ) : null}
    </header>
  );
}
