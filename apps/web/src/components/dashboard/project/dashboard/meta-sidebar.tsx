// Project Dashboard — Meta sidebar (Story 04, PRD §11.5).
//
// Right rail on desktop (≥1024px, sticky-top within the panel) /
// horizontal chip strip on mobile (<1024px). 5 fields:
//
//   1. Stage chip + state-machine forward CTA
//   2. Money summary (agreed / paid / outstanding) → links to Money tab
//   3. Next session (date + time + studio)
//   4. Files (count + total size)
//   5. Artist (avatar + name + message/email buttons)
//
// We render the same content twice in two layouts (chip strip vs full
// rail) so we can hide each via Tailwind's lg: breakpoint without
// JavaScript. This avoids the layout shift you'd get from rendering
// only one layout and swapping at runtime.

import Link from "next/link";

import {
  STAGE_LABEL,
  type Stage,
} from "~/lib/projects/stages";
import { fmtDateTime } from "~/lib/time/relative";

import { formatFileSize, formatMoney } from "./dashboard-helpers";

export interface MetaSidebarMoney {
  cents: number;
  currency: string;
}

export interface MetaSidebarSession {
  id: string;
  startsAt: Date;
  durationMin: number;
  packageName: string | null;
}

export interface MetaSidebarArtist {
  name: string;
  avatarUrl: string | null;
  email: string;
}

export interface MetaSidebarData {
  stage: Stage;
  agreedAmount: MetaSidebarMoney | null;
  paidAmount: MetaSidebarMoney | null;
  outstandingAmount: MetaSidebarMoney | null;
  nextSession: MetaSidebarSession | null;
  fileCount: number;
  fileTotalBytes: number;
  artist: MetaSidebarArtist;
}

export interface MetaSidebarProps {
  sidebar: MetaSidebarData;
  projectId: string;
}

export function MetaSidebar({ sidebar, projectId }: MetaSidebarProps) {
  // Pre-format derived values so chip + rail layouts share them.
  const moneyHref = `/dashboard/projects/${projectId}?tab=money`;
  const fileSummary = sidebar.fileCount
    ? `${String(sidebar.fileCount)} file${sidebar.fileCount === 1 ? "" : "s"} · ${formatFileSize(sidebar.fileTotalBytes)}`
    : "No files yet";
  const sessionSummary = sidebar.nextSession
    ? fmtDateTime(sidebar.nextSession.startsAt)
    : "No upcoming session";
  const moneySummary = sidebar.outstandingAmount
    ? `Outstanding ${formatMoney(sidebar.outstandingAmount.cents, sidebar.outstandingAmount.currency)}`
    : sidebar.paidAmount
      ? `Paid ${formatMoney(sidebar.paidAmount.cents, sidebar.paidAmount.currency)}`
      : sidebar.agreedAmount
        ? `Agreed ${formatMoney(sidebar.agreedAmount.cents, sidebar.agreedAmount.currency)}`
        : "—";

  return (
    <>
      {/* ─── Mobile chip strip (visible <1024px) ─────────────────── */}
      <div className="sk-scroll-x -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:hidden">
        <Chip label="Stage">{STAGE_LABEL[sidebar.stage]}</Chip>
        <Link
          href={moneyHref}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-xs text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            Money
          </span>
          <span className="text-[rgb(var(--fg-primary))]">{moneySummary}</span>
        </Link>
        <Chip label="Next session">{sessionSummary}</Chip>
        <Chip label="Files">{fileSummary}</Chip>
        <Chip label="Artist">{sidebar.artist.name}</Chip>
      </div>

      {/* ─── Desktop right rail (visible ≥1024px) ─────────────────── */}
      <aside
        aria-label="Project meta"
        className="hidden flex-col gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 lg:flex"
      >
        {/* Stage row */}
        <Field label="Stage">
          <span className="text-sm font-semibold text-[rgb(var(--fg-primary))]">
            {STAGE_LABEL[sidebar.stage]}
          </span>
        </Field>

        {/* Money row → Money tab */}
        <Field label="Money">
          <Link
            href={moneyHref}
            className="text-sm text-[rgb(var(--fg-primary))] hover:text-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] rounded"
          >
            {moneySummary}
          </Link>
          {sidebar.paidAmount ? (
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] mt-0.5">
              Paid {formatMoney(sidebar.paidAmount.cents, sidebar.paidAmount.currency)}
            </p>
          ) : null}
          {sidebar.agreedAmount ? (
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              Agreed {formatMoney(sidebar.agreedAmount.cents, sidebar.agreedAmount.currency)}
            </p>
          ) : null}
        </Field>

        {/* Next session row */}
        <Field label="Next session">
          {sidebar.nextSession ? (
            <>
              <p className="text-sm text-[rgb(var(--fg-primary))]">
                {sessionSummary}
              </p>
              {sidebar.nextSession.packageName ? (
                <p className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] mt-0.5">
                  {sidebar.nextSession.packageName}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-[rgb(var(--fg-muted))]">—</p>
          )}
        </Field>

        {/* Files row */}
        <Field label="Files">
          <p className="text-sm text-[rgb(var(--fg-primary))]">{fileSummary}</p>
        </Field>

        {/* Artist row + contact buttons */}
        <Field label="Artist">
          <div className="flex items-center gap-2">
            {sidebar.artist.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sidebar.artist.avatarUrl}
                alt=""
                aria-hidden="true"
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-base))] font-mono text-xs font-semibold text-[rgb(var(--fg-secondary))]"
              >
                {computeInitials(sidebar.artist.name)}
              </div>
            )}
            <p className="min-w-0 flex-1 truncate text-sm text-[rgb(var(--fg-primary))]">
              {sidebar.artist.name}
            </p>
          </div>
          <div className="mt-2 flex gap-2">
            <a
              href={`mailto:${sidebar.artist.email}`}
              className={[
                "inline-flex min-h-[36px] items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-3 text-xs text-[rgb(var(--fg-secondary))] transition-colors",
                "hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
              ].join(" ")}
            >
              Email
            </a>
            {/* Message button is a stub — wires to artist messaging in
                a later story. For now, behaves like Email so the row
                still reads as "two contact options". */}
            <a
              href={`mailto:${sidebar.artist.email}`}
              className={[
                "inline-flex min-h-[36px] items-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] px-3 text-xs text-[rgb(var(--fg-secondary))] transition-colors",
                "hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
              ].join(" ")}
            >
              Message
            </a>
          </div>
        </Field>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-xs">
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
        {label}
      </span>
      <span className="text-[rgb(var(--fg-primary))]">{children}</span>
    </span>
  );
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
