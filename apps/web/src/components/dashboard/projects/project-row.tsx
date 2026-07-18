"use client";

import Link from "next/link";
import type { DragEvent } from "react";
import { ChevronRight, GripVertical } from "lucide-react";

import { ProjectActionControls } from "~/components/dashboard/projects/project-action-controls";
import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";

// Status pill tone — drives a small uppercase pill on each row that
// reads "Overdue" / "Awaiting reply" / "On track" / "Done" etc.
// Four visual tones map to the same four tokens the rest of the
// dashboard uses (danger / warn / ok / neutral).
//
// The prototype prefixes its pill class with `pill-` so reviewers can
// grep for it; we keep the same naming for compatibility with the
// design doc text.
export type ProjectRowStatusTone = "danger" | "warn" | "ok" | "neutral";

export interface ProjectRowData {
  id: string;
  title: string;
  lifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  workflowStage: WorkflowStage;
  client: string;
  /** Client email — rendered muted UNDER the client name in the client
   *  column (G7 design alignment). Previously this was passed as `meta`
   *  and rendered under the title; both column placement and label have
   *  been corrected. */
  clientEmail?: string;
  /** 0..100 progress percentage; null when lifecycle alone cannot support a percentage. */
  progress: number | null;
  /** Outstanding balance in cents; null while purchase payments are unavailable. */
  balance: number | null;
  /** Human-formatted deadline string e.g. "3d" or "May 28". */
  deadline: string;
  /** Status pill label, e.g. "Overdue" / "On track". */
  status: string;
  /** Status pill tone — drives the color of the pill. */
  statusTone: ProjectRowStatusTone;
  /** Optional currency code to format balance with. */
  currency?: string;
  /** Last-updated timestamp (ISO) — drives "recent" sort. */
  updatedAtIso?: string;
  /** Deadline timestamp (ISO, null when no upcoming session) — drives "deadline" sort. */
  deadlineAtIso?: string | null;
  /** Exact advisory result; the server rechecks under lock before deleting. */
  canPermanentlyDelete: boolean;
}

interface ProjectRowProps {
  row: ProjectRowData;
  onDragStart?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  /**
   * SK-64 — omit the client name from the MOBILE meta line. Set by the
   * Client Space page, where every row belongs to the client whose
   * page you're on. Desktop columns are unaffected.
   */
  hideClient?: boolean;
}

function toneClass(tone: ProjectRowStatusTone): string {
  if (tone === "danger") return "pill-danger";
  if (tone === "warn") return "pill-warn";
  if (tone === "ok") return "pill-ok";
  return "pill-neutral";
}

function toneStyle(tone: ProjectRowStatusTone): {
  background: string;
  borderColor: string;
  color: string;
} {
  if (tone === "danger") {
    return {
      background: "rgb(var(--fg-danger)/0.12)",
      borderColor: "rgb(var(--fg-danger)/0.40)",
      color: "rgb(var(--fg-danger))",
    };
  }
  if (tone === "warn") {
    return {
      background: "rgb(var(--fg-warning)/0.12)",
      borderColor: "rgb(var(--fg-warning)/0.40)",
      color: "rgb(var(--fg-warning))",
    };
  }
  if (tone === "ok") {
    return {
      background: "rgb(var(--fg-success)/0.12)",
      borderColor: "rgb(var(--fg-success)/0.40)",
      color: "rgb(var(--fg-success))",
    };
  }
  return {
    background: "rgb(var(--fg-muted)/0.10)",
    borderColor: "rgb(var(--border-subtle))",
    color: "rgb(var(--fg-muted))",
  };
}

function formatMoney(cents: number, currency: string): string {
  // Defensive — never throw on bad currency input.
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export function ProjectRow({ row, hideClient, onDragStart, onDragOver, onDrop }: ProjectRowProps) {
  const {
    id,
    title,
    client,
    clientEmail,
    progress,
    balance,
    deadline,
    status,
    statusTone,
    currency = "USD",
  } = row;
  const initials = producerInitials(client || title);
  const badgeBg = producerGradient(client || title);

  const tone = toneStyle(statusTone);
  const toneCls = toneClass(statusTone);
  const actionProject = {
    id: row.id,
    title: row.title,
    clientName: row.client,
    lifecycleStatus: row.lifecycleStatus,
    workflowStage: row.workflowStage,
    deadlineAtIso: row.deadlineAtIso ?? null,
    canDeleteEmptyDraft: row.canPermanentlyDelete,
  };
  // G9 — 3px left accent bar (design HTML 170–172): paints a vertical
  // attention strip on danger/warn rows so "needs attention" reads at
  // a glance, not only via the small pill. Neutral/ok rows get no bar.
  const accentBarColor =
    statusTone === "danger"
      ? "rgb(var(--fg-danger))"
      : statusTone === "warn"
        ? "rgb(var(--fg-warning))"
        : null;

  return (
    <div
      draggable="true"
      data-id={id}
      onDragStart={
        onDragStart
          ? (e) => {
              onDragStart(e, id);
            }
          : undefined
      }
      onDragOver={
        onDragOver
          ? (e) => {
              onDragOver(e, id);
            }
          : undefined
      }
      onDrop={
        onDrop
          ? (e) => {
              onDrop(e, id);
            }
          : undefined
      }
      className="group relative overflow-hidden rounded-[var(--radius-md)] border transition-colors hover:border-[rgb(var(--border-strong))]"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      {accentBarColor ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
          style={{ background: accentBarColor }}
        />
      ) : null}

      {/* Desktop (md+) — exact 8-column grid, unchanged from the
          original single-layout row. Hidden below md where the grid's
          fixed tracks (~650px) cannot fit a phone viewport. */}
      <div
        className="hidden items-center gap-3 px-3 py-2.5 md:grid"
        style={{
          gridTemplateColumns: "24px 44px minmax(0,1.6fr) minmax(0,1fr) 120px 100px 110px 36px",
        }}
      >
        <span
          // G8 — grip is permanently visible at muted opacity so the user
          // sees at-a-glance that rows are reorderable. Brightens on row
          // hover for affordance.
          className="flex h-6 w-6 cursor-grab items-center justify-center opacity-60 transition-opacity group-hover:opacity-100"
          style={{ color: "rgb(var(--fg-muted))" }}
          aria-hidden
        >
          <GripVertical size={14} />
        </span>

        <span
          className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-[12px] font-bold text-white"
          style={{ background: badgeBg }}
          aria-hidden
        >
          {initials}
        </span>

        <div className="min-w-0">
          <Link
            href={`/dashboard/clients-projects/${id}`}
            className="block truncate text-[14px] font-semibold focus-visible:underline focus-visible:outline-none"
            style={{ color: "rgb(var(--fg-default))" }}
          >
            {title}
          </Link>
          {/* G10 — solid tinted status pill matching design HTML 131–135:
            6px radius, 9.5px uppercase with wide tracking, tinted fill +
            22% border. toneStyle already gives the tinted colors. */}
          <span
            className={`mt-1 inline-flex items-center rounded-[6px] border px-1.5 py-[2px] text-[9.5px] font-semibold tracking-[0.1em] uppercase ${toneCls}`}
            style={tone}
          >
            {status}
          </span>
        </div>

        <div className="min-w-0">
          <p
            className="truncate text-[13px] font-medium"
            style={{ color: "rgb(var(--fg-default))" }}
          >
            {client}
          </p>
          {clientEmail ? (
            <p className="truncate text-[11px]" style={{ color: "rgb(var(--fg-muted))" }}>
              {clientEmail}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full"
            style={{ background: "rgb(var(--border-subtle))" }}
            aria-hidden
          >
            <div
              className="h-full"
              style={{
                width:
                  progress === null ? "0%" : `${String(Math.max(0, Math.min(100, progress)))}%`,
                background: "rgb(var(--brand-primary))",
              }}
            />
          </div>
          <span
            className="w-16 text-right text-[11px] tabular-nums"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            {progress === null ? "Unavailable" : `${String(progress)}%`}
          </span>
        </div>

        <div
          className="text-right text-[13px] font-medium tabular-nums"
          style={{
            color:
              balance !== null && balance > 0 ? "rgb(var(--fg-danger))" : "rgb(var(--fg-muted))",
          }}
        >
          {balance === null ? "Unavailable" : balance > 0 ? formatMoney(balance, currency) : "—"}
        </div>

        <div className="text-right text-[12px]" style={{ color: "rgb(var(--fg-muted))" }}>
          {deadline}
        </div>

        {/* Decorative — lucide-react auto-marks the SVG aria-hidden when
          no aria-* / role / title prop is set. The visible pill above
          already conveys status text to screen readers. */}
        <ChevronRight size={14} style={{ color: "rgb(var(--fg-muted))" }} />
      </div>

      {/* Mobile (<md) — SK-47: 2-line card-style row. Line 1 = avatar +
          title + status pill, line 2 = client · deadline · balance.
          The whole row is one Link (>=44px tap target); the drag grip
          is desktop-only (touch drag conflicts with scroll). */}
      <Link
        href={`/dashboard/clients-projects/${id}`}
        className="flex min-h-[44px] items-center gap-3 px-3.5 py-3 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.4)] focus-visible:outline-none focus-visible:ring-inset md:hidden"
        draggable={false}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[12px] font-bold text-white"
          style={{ background: badgeBg }}
          aria-hidden
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className="min-w-0 truncate text-[14px] font-semibold"
              style={{ color: "rgb(var(--fg-default))" }}
            >
              {title}
            </span>
            <span
              className={`inline-flex shrink-0 items-center rounded-[6px] border px-1.5 py-[2px] text-[9.5px] font-semibold tracking-[0.1em] uppercase ${toneCls}`}
              style={tone}
            >
              {status}
            </span>
          </span>
          {/* SK-64 — meta segments are conditional: the client name is
              omitted inside that client's own space, and a missing
              deadline no longer renders a dangling em dash. */}
          {!hideClient || deadline !== "\u2014" || balance === null || balance > 0 ? (
            <span
              className="mt-1 flex items-center gap-1 text-[12px]"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              {!hideClient ? <span className="min-w-0 truncate">{client}</span> : null}
              {deadline !== "\u2014" ? (
                <>
                  {!hideClient ? <span aria-hidden>&middot;</span> : null}
                  <span className="shrink-0">{deadline}</span>
                </>
              ) : null}
              {balance === null ? (
                <>
                  {!hideClient || deadline !== "\u2014" ? <span aria-hidden>&middot;</span> : null}
                  <span className="shrink-0 font-semibold">Balance unavailable</span>
                </>
              ) : balance > 0 ? (
                <>
                  {!hideClient || deadline !== "\u2014" ? <span aria-hidden>&middot;</span> : null}
                  <span
                    className="shrink-0 font-semibold tabular-nums"
                    style={{ color: "rgb(var(--fg-danger))" }}
                  >
                    {formatMoney(balance, currency)}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
        <ChevronRight size={16} className="shrink-0" style={{ color: "rgb(var(--fg-muted))" }} />
      </Link>

      <div
        className="border-t px-3 py-2.5"
        style={{ borderColor: "rgb(var(--border-subtle))" }}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <ProjectActionControls project={actionProject} />
      </div>
    </div>
  );
}
