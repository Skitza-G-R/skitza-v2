"use client";

import Link from "next/link";
import type { DragEvent } from "react";
import { ChevronRight, GripVertical } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import { CLIENTS_TABLE_GRID } from "~/components/dashboard/clients-projects/clients-table-header";

import { LinkPill } from "./link-pill";
import type { ClientCardData } from "./client-card";

// Real-table compact row for the Clients tab's TABLE mode. Mockup-
// match: 10 columns aligned to ClientsTableHeader's grid via the
// shared CLIENTS_TABLE_GRID export. NO per-row card chrome — rows
// sit inside a single shared container (mounted in
// WorkspaceListView), separated by hairlines, with a subtle hover
// fill. Each row is fully clickable via an absolute-positioned Link
// overlay (same idea as ClientCard).
//
// Drag-to-reorder uses the same HTML5 contract as ClientCard so the
// parent's drag handlers don't need to branch on layout.

interface ClientCompactRowProps {
  client: ClientCardData;
  onInvite?: (client: ClientCardData) => void;
  onDragStart?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, id: string) => void;
}

function formatMoney(cents: number, currency: string): string {
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

// Short joined-date label — "Nov 2025" / "Mar 2026". Falls back to "—"
// when the ISO timestamp is missing (legacy rows without firstSeenAt
// pre-migration 0028).
function formatJoined(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

export function ClientCompactRow({
  client,
  onInvite,
  onDragStart,
  onDragOver,
  onDrop,
}: ClientCompactRowProps) {
  const {
    id,
    name,
    email,
    linkState,
    projects,
    lifetime,
    owed,
    currency = "USD",
    joinedAtIso,
  } = client;

  const initials = producerInitials(name);
  const avatarBg = producerGradient(name);

  return (
    <div
      draggable="true"
      data-id={id}
      data-testid="clients-table-row"
      onDragStart={onDragStart ? (e) => { onDragStart(e, id); } : undefined}
      onDragOver={onDragOver ? (e) => { onDragOver(e, id); } : undefined}
      onDrop={onDrop ? (e) => { onDrop(e, id); } : undefined}
      className="group relative grid items-center gap-3 border-b px-3 py-3 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] last:border-b-0 hover:bg-[rgb(var(--bg-background)/0.55)]"
      style={{
        borderBottomColor: "rgb(var(--border-subtle))",
        gridTemplateColumns: CLIENTS_TABLE_GRID,
      }}
    >
      {/* Whole-row click target — sits at z-0 so per-cell interactive
          elements (LinkPill in 'none' state, drag handle) stay
          clickable on top via z-10. */}
      <Link
        href={`/dashboard/clients-projects/clients/${id}`}
        className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary)/0.4)]"
        aria-label={`Open ${name}`}
      />

      {/* Grip — opacity 0 by default, 0.6 on row hover. Pointer-events
          on so dragstart works without bubbling to the Link. */}
      <span
        className="relative z-10 flex h-6 w-6 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-60"
        style={{ color: "rgb(var(--fg-muted))" }}
        aria-hidden
      >
        <GripVertical size={14} />
      </span>

      {/* Circular avatar */}
      <span
        className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full font-mono text-[12px] font-bold text-white"
        style={{ background: avatarBg }}
        aria-hidden
      >
        {initials}
      </span>

      {/* Client name (CLIENT column) */}
      <span
        className="relative z-10 min-w-0 truncate text-[13.5px] font-semibold"
        style={{ color: "rgb(var(--fg-default))" }}
      >
        {name}
      </span>

      {/* Email (separate EMAIL column — was nested under name before) */}
      <span
        className="relative z-10 min-w-0 truncate text-[12.5px]"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {email ?? "—"}
      </span>

      {/* Link state (LINK column) — interactive only when state='none' */}
      <span className="relative z-10 inline-flex">
        {onInvite ? (
          <LinkPill
            state={linkState}
            onInvite={() => {
              onInvite(client);
            }}
          />
        ) : (
          <LinkPill state={linkState} />
        )}
      </span>

      {/* Projects (right-aligned numeric) */}
      <span
        className="relative z-10 text-right font-mono text-[13.5px] font-bold tabular-nums"
        style={{ color: "rgb(var(--fg-default))" }}
      >
        {projects}
      </span>

      {/* Lifetime (right-aligned, neutral) */}
      <span
        className="relative z-10 text-right font-mono text-[13.5px] font-bold tabular-nums"
        style={{ color: "rgb(var(--fg-default))" }}
      >
        {formatMoney(lifetime, currency)}
      </span>

      {/* Owed (right-aligned, danger when > 0) */}
      <span
        className="relative z-10 text-right font-mono text-[13.5px] font-bold tabular-nums"
        style={{
          color:
            owed > 0
              ? "rgb(var(--fg-danger))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {owed > 0 ? formatMoney(owed, currency) : "—"}
      </span>

      {/* Joined (Mon YYYY) */}
      <span
        className="relative z-10 text-[12.5px]"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        {formatJoined(joinedAtIso)}
      </span>

      {/* Trailing chevron */}
      <ChevronRight
        size={14}
        className="relative z-10"
        style={{ color: "rgb(var(--fg-muted))" }}
        aria-hidden
      />
    </div>
  );
}
