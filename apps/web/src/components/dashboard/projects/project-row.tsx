"use client";

import Link from "next/link";
import type { DragEvent } from "react";
import { ChevronRight, GripVertical } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

// Status pill tone — drives a small uppercase tag on each row that
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
  client: string;
  /** Optional second-line meta — e.g. client email or the song count. */
  meta?: string;
  /** 0..100 progress percentage. */
  progress: number;
  /** Outstanding balance in cents (negative or zero = no balance). */
  balance: number;
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
}

interface ProjectRowProps {
  row: ProjectRowData;
  onDragStart?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, id: string) => void;
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

export function ProjectRow({
  row,
  onDragStart,
  onDragOver,
  onDrop,
}: ProjectRowProps) {
  const {
    id,
    title,
    client,
    meta,
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

  return (
    <div
      draggable="true"
      data-id={id}
      onDragStart={onDragStart ? (e) => { onDragStart(e, id); } : undefined}
      onDragOver={onDragOver ? (e) => { onDragOver(e, id); } : undefined}
      onDrop={onDrop ? (e) => { onDrop(e, id); } : undefined}
      className="group grid items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition-colors hover:border-[rgb(var(--border-strong))]"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
        gridTemplateColumns:
          "24px 44px minmax(0,1.6fr) minmax(0,1fr) 120px 100px 110px 36px",
      }}
    >
      <span
        className="flex h-6 w-6 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
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
          className="block truncate text-[14px] font-semibold focus-visible:outline-none focus-visible:underline"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          {title}
        </Link>
        <span
          className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneCls}`}
          style={tone}
        >
          {status}
        </span>
        {meta ? (
          <p
            className="mt-0.5 truncate text-[11px]"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            {meta}
          </p>
        ) : null}
      </div>

      <div className="min-w-0">
        <p
          className="truncate text-[13px]"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          {client}
        </p>
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
              width: `${String(Math.max(0, Math.min(100, progress)))}%`,
              background: "rgb(var(--brand-primary))",
            }}
          />
        </div>
        <span
          className="w-9 text-right text-[11px] tabular-nums"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          {progress}%
        </span>
      </div>

      <div
        className="text-right text-[13px] font-medium tabular-nums"
        style={{
          color:
            balance > 0
              ? "rgb(var(--fg-danger))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {balance > 0 ? formatMoney(balance, currency) : "—"}
      </div>

      <div
        className="text-right text-[12px]"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {deadline}
      </div>

      <ChevronRight
        size={14}
        style={{ color: "rgb(var(--fg-muted))" }}
        aria-label={`Status: ${status}`}
      />
    </div>
  );
}
