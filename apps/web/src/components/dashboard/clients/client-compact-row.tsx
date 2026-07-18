"use client";

import Link from "next/link";
import type { DragEvent } from "react";
import { Archive, ArchiveRestore, GripVertical, Pencil } from "lucide-react";

import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
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
  onEdit?: (client: ClientCardData) => void;
  onArchive?: (client: ClientCardData) => void;
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
  onEdit,
  onArchive,
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
    archived,
  } = client;

  const initials = producerInitials(name);
  const avatarBg = producerGradient(name);

  return (
    <div
      draggable="true"
      data-id={id}
      data-testid="clients-table-row"
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
      className="group relative border-b transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] last:border-b-0 hover:bg-[rgb(var(--bg-background)/0.55)]"
      style={{
        borderBottomColor: "rgb(var(--border-subtle))",
      }}
    >
      {/* Whole-row click target — sits at z-0 so per-cell interactive
          elements (LinkPill in 'none' state, drag handle) stay
          clickable on top via z-10. */}
      <Link
        href={`/dashboard/clients-projects/clients/${id}`}
        className="absolute inset-0 z-0 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.4)] focus-visible:outline-none focus-visible:ring-inset"
        aria-label={`Open ${name}`}
      />

      {/* Desktop (lg+) — exact 10-column grid. Hidden where its fixed
          data tracks would squeeze or overflow. */}
      <div
        className="hidden items-center gap-3 px-3 py-3 xl:grid"
        style={{ gridTemplateColumns: CLIENTS_TABLE_GRID }}
      >
        {/* Grip — opacity 0 by default, 0.6 on row hover. Pointer-events
          on so dragstart works without bubbling to the Link. */}
        <span
          className="relative z-10 flex h-6 w-6 cursor-grab items-center justify-center opacity-60 transition-opacity hover:opacity-100"
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
          {lifetime === null ? "Unavailable" : formatMoney(lifetime, currency)}
        </span>

        {/* Owed (right-aligned, danger when > 0) */}
        <span
          className="relative z-10 text-right font-mono text-[13.5px] font-bold tabular-nums"
          style={{
            color: owed !== null && owed > 0 ? "rgb(var(--fg-danger))" : "rgb(var(--fg-muted))",
          }}
        >
          {owed === null ? "Unavailable" : owed > 0 ? formatMoney(owed, currency) : "—"}
        </span>

        {/* Joined (Mon YYYY) */}
        <span className="relative z-10 text-[12.5px]" style={{ color: "rgb(var(--fg-muted))" }}>
          {formatJoined(joinedAtIso)}
        </span>

        <span className="relative z-20 grid grid-cols-2 gap-1.5">
          {onEdit ? (
            <button
              type="button"
              onClick={() => {
                onEdit(client);
              }}
              className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-[var(--radius-md)] border px-2 text-[11px] font-semibold hover:bg-[rgb(var(--bg-background))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
              style={{ borderColor: "rgb(var(--border-subtle))" }}
            >
              <Pencil size={12} aria-hidden />
              Edit
            </button>
          ) : (
            <span />
          )}
          {onArchive ? (
            <button
              type="button"
              onClick={() => {
                onArchive(client);
              }}
              className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-[var(--radius-md)] border px-2 text-[11px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
              style={{ borderColor: "rgb(var(--border-subtle))" }}
            >
              {archived ? (
                <ArchiveRestore size={12} aria-hidden />
              ) : (
                <Archive size={12} aria-hidden />
              )}
              {archived ? "Restore" : "Archive"}
            </button>
          ) : null}
        </span>
      </div>

      {/* Compact (<lg) — SK-47: 2-line card-style row. Line 1 = avatar +
          name + LinkPill, line 2 = email · projects · owed. The Link
          overlay above covers the whole row (>=44px tap target); the
          drag grip is desktop-only (touch drag conflicts with scroll). */}
      <div className="xl:hidden">
        <div className="flex min-h-[44px] items-center gap-3 px-4 py-3">
          <span
            className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-bold text-white"
            style={{ background: avatarBg }}
            aria-hidden
          >
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span
                className="min-w-0 truncate text-[13.5px] font-semibold"
                style={{ color: "rgb(var(--fg-default))" }}
              >
                {name}
              </span>
              <span className="relative z-10 inline-flex shrink-0">
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
            </span>
            <span
              className="mt-1 flex items-center gap-1 text-[12px]"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              <span className="min-w-0 truncate">{email ?? "No email"}</span>
              <span aria-hidden>&middot;</span>
              <span className="shrink-0 tabular-nums">
                {projects} {projects === 1 ? "project" : "projects"}
              </span>
              {owed === null ? (
                <>
                  <span aria-hidden>&middot;</span>
                  <span className="shrink-0 font-semibold">Totals unavailable</span>
                </>
              ) : owed > 0 ? (
                <>
                  <span aria-hidden>&middot;</span>
                  <span
                    className="shrink-0 font-semibold tabular-nums"
                    style={{ color: "rgb(var(--fg-danger))" }}
                  >
                    {formatMoney(owed, currency)} owed
                  </span>
                </>
              ) : null}
            </span>
          </span>
        </div>
        {onEdit || onArchive ? (
          <div className="relative z-20 grid grid-cols-2 gap-2 px-4 pb-3">
            {onEdit ? (
              <button
                type="button"
                onClick={() => {
                  onEdit(client);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border text-[12px] font-semibold focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              >
                <Pencil size={13} aria-hidden />
                Edit
              </button>
            ) : (
              <span />
            )}
            {onArchive ? (
              <button
                type="button"
                onClick={() => {
                  onArchive(client);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border text-[12px] font-semibold text-[rgb(var(--fg-muted))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              >
                {archived ? (
                  <ArchiveRestore size={13} aria-hidden />
                ) : (
                  <Archive size={13} aria-hidden />
                )}
                {archived ? "Restore" : "Archive"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
