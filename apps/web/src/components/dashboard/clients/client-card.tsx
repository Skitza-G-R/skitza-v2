"use client";

import Link from "next/link";
import type { DragEvent } from "react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import { LinkPill, type LinkPillState } from "./link-pill";

export interface ClientCardData {
  id: string;
  name: string;
  email: string | null;
  linkState: LinkPillState;
  /** Number of active projects with this client. */
  projects: number;
  /** Total lifetime spend in cents. */
  lifetime: number;
  /** Outstanding balance in cents (0 if all settled). */
  owed: number;
  /** Optional currency code — defaults to USD. */
  currency?: string;
  /** Last activity timestamp (ISO) — drives "recent" sort. */
  lastActivityIso?: string;
}

interface ClientCardProps {
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

export function ClientCard({
  client,
  onInvite,
  onDragStart,
  onDragOver,
  onDrop,
}: ClientCardProps) {
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
      className="group relative flex flex-col gap-3.5 rounded-[var(--radius-md)] border p-4 transition-colors hover:border-[rgb(var(--border-strong))]"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <Link
        href={`/dashboard/clients-projects/clients/${id}`}
        className="absolute inset-0 z-0 rounded-[var(--radius-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        aria-label={`Open ${name}`}
      />

      <div className="relative z-10 flex items-start gap-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[14px] font-bold text-white"
          style={{ background: avatarBg }}
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className="truncate text-[14px] font-semibold"
              style={{ color: "rgb(var(--fg-default))" }}
            >
              {name}
            </p>
          </div>
          {email ? (
            <p
              className="truncate text-[12px]"
              style={{ color: "rgb(var(--fg-muted))" }}
            >
              {email}
            </p>
          ) : null}
        </div>
        <div className="relative z-20 pointer-events-auto">
          {onInvite ? (
            <LinkPill
              state={linkState}
              onInvite={() => { onInvite(client); }}
            />
          ) : (
            <LinkPill state={linkState} />
          )}
        </div>
      </div>

      <div
        className="relative z-10 grid grid-cols-3 gap-2 rounded-[var(--radius-sm)] border px-3 py-2.5"
        style={{
          background: "rgb(var(--bg-background))",
          borderColor: "rgb(var(--border-subtle))",
        }}
      >
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            Projects
          </span>
          <span
            className="text-[14px] font-semibold tabular-nums"
            style={{ color: "rgb(var(--fg-default))" }}
          >
            {projects}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            Lifetime
          </span>
          <span
            className="text-[14px] font-semibold tabular-nums"
            style={{ color: "rgb(var(--fg-default))" }}
          >
            {formatMoney(lifetime, currency)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: "rgb(var(--fg-muted))" }}
          >
            Owed
          </span>
          <span
            className="text-[14px] font-semibold tabular-nums"
            style={{
              color:
                owed > 0
                  ? "rgb(var(--fg-danger))"
                  : "rgb(var(--fg-muted))",
            }}
          >
            {owed > 0 ? formatMoney(owed, currency) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
