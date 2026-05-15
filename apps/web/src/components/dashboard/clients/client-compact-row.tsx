"use client";

import Link from "next/link";
import type { DragEvent } from "react";
import { ChevronRight, GripVertical } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

import { LinkPill } from "./link-pill";
import type { ClientCardData } from "./client-card";

// Compact horizontal client row used in the Clients tab's TABLE mode
// (G18 follow-up). Mirrors ClientCard's data contract but lays the
// stats out in a single 8-column grid that lines up with
// ClientsTableHeader. Cards mode keeps the full ClientCard.
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
  } = client;

  const initials = producerInitials(name);
  const avatarBg = producerGradient(name);

  return (
    <div
      draggable="true"
      data-id={id}
      onDragStart={onDragStart ? (e) => { onDragStart(e, id); } : undefined}
      onDragOver={onDragOver ? (e) => { onDragOver(e, id); } : undefined}
      onDrop={onDrop ? (e) => { onDrop(e, id); } : undefined}
      className="group relative grid items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition-colors hover:border-[rgb(var(--border-strong))]"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
        gridTemplateColumns:
          "24px 44px minmax(0,1.5fr) 80px 110px 110px 110px 36px",
      }}
    >
      <span
        className="flex h-6 w-6 cursor-grab items-center justify-center opacity-60 transition-opacity group-hover:opacity-100"
        style={{ color: "rgb(var(--fg-muted))" }}
        aria-hidden
      >
        <GripVertical size={14} />
      </span>

      <span
        className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] font-mono text-[12px] font-bold text-white"
        style={{ background: avatarBg }}
        aria-hidden
      >
        {initials}
      </span>

      <div className="min-w-0">
        <Link
          href={`/dashboard/clients-projects/clients/${id}`}
          className="block truncate text-[14px] font-semibold focus-visible:outline-none focus-visible:underline"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          {name}
        </Link>
        {email ? (
          <p
            className="truncate text-[11px]"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            {email}
          </p>
        ) : null}
      </div>

      <span
        className="text-right font-mono text-[14px] font-bold tabular-nums"
        style={{ color: "rgb(var(--fg-default))" }}
      >
        {projects}
      </span>

      <span
        className="text-right font-mono text-[14px] font-bold tabular-nums"
        style={{ color: "rgb(var(--fg-default))" }}
      >
        {formatMoney(lifetime, currency)}
      </span>

      <span
        className="text-right font-mono text-[14px] font-bold tabular-nums"
        style={{
          color:
            owed > 0
              ? "rgb(var(--fg-danger))"
              : "rgb(var(--fg-muted))",
        }}
      >
        {owed > 0 ? formatMoney(owed, currency) : "—"}
      </span>

      <div className="flex items-center">
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
      </div>

      <ChevronRight
        size={14}
        style={{ color: "rgb(var(--fg-muted))" }}
        aria-hidden
      />
    </div>
  );
}
