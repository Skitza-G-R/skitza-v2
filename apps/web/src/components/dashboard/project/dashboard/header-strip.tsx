// Project Dashboard — Header strip (Story 04, PRD §11.5).
//
// Top of the focal column: artist initials + project title + stage
// chip + ONE morphing primary CTA. The CTA copy is keyed off the
// project's stage via `pickHeaderCta` (see dashboard-helpers.ts) — one
// control per project state, so the producer never has to choose
// between competing buttons. This is the contract that makes the
// Dashboard tab "scannable" per the PRD.
//
// The CTA is a stub <button> in this story — wire-up to the real
// stage-forwarding mutation lands in a later S0X. The button stays
// inert (no onClick) but the visual reads correctly so the UX critic
// can review it.

import { Badge } from "~/components/ui/badge";
import {
  STAGE_LABEL,
  type Stage,
} from "~/lib/projects/stages";
import { STATE_LABEL, stageToState } from "~/lib/projects/states";

import { pickHeaderCta } from "./dashboard-helpers";

export interface HeaderStripProps {
  artistName: string;
  artistAvatarUrl: string | null;
  projectTitle: string;
  stage: Stage;
}

export function HeaderStrip({
  artistName,
  artistAvatarUrl,
  projectTitle,
  stage,
}: HeaderStripProps) {
  const cta = pickHeaderCta(stage);
  const initials = computeInitials(artistName);

  return (
    <header className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3 sm:items-center">
        {/* Avatar — initials fallback when artistAvatarUrl is null. */}
        {artistAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artistAvatarUrl}
            alt=""
            aria-hidden="true"
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-base))] font-mono text-sm font-semibold text-[rgb(var(--fg-secondary))]"
          >
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Mono eyebrow row — artist + stage chip — sits above the
              title so the project title gets undivided attention. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate text-sm text-[rgb(var(--fg-secondary))]">
              {artistName}
            </p>
            <Badge variant="neutral" role="status" aria-label={`Stage: ${STAGE_LABEL[stage]}`}>
              {STATE_LABEL[stageToState(stage)]}
            </Badge>
            {STAGE_LABEL[stage] !== STATE_LABEL[stageToState(stage)] ? (
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[rgb(var(--fg-muted))]">
                {STAGE_LABEL[stage]}
              </span>
            ) : null}
          </div>

          <h2
            className="mt-1 truncate font-display text-2xl leading-tight tracking-tight sm:text-3xl"
            style={{ fontWeight: 800 }}
          >
            {projectTitle}
          </h2>
        </div>

        {cta ? (
          <button
            type="button"
            // TODO: wire to the stage-forward action mutation in a
            // later story (the action is intentionally stubbed for
            // S04 — story-spec scope is the morphing copy contract).
            // No onClick yet — adding one here would force this file
            // to be a Client Component, which is wasteful for a stub.
            // The wire-up story will add `"use client"` + onClick
            // together (or, better, hand the action off to a small
            // <StageForwardButton client component) at that time.
            aria-label={cta.label}
            className={[
              "inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] px-4 text-sm font-semibold transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
              cta.intent === "primary"
                ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] hover:bg-[rgb(var(--brand-primary)/0.9)] sk-lift"
                : "bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] border border-[rgb(var(--border-subtle))] hover:border-[rgb(var(--border-strong))]",
            ].join(" ")}
          >
            {cta.label}
          </button>
        ) : null}
      </div>
    </header>
  );
}

// ─── computeInitials ────────────────────────────────────────────────
// Local copy of the helper used elsewhere in the project room — we
// don't import from project-header.tsx because that file is a heavy
// `"use client"` module and we want HeaderStrip to stay server-safe
// where possible.
function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
