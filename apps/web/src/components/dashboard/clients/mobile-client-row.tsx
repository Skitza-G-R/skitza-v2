"use client";

import { Check, ChevronRight, Clock3 } from "lucide-react";
import Link from "next/link";

import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";

import { ClientActionsMenu } from "./client-actions-menu";
import type { ClientCardData } from "./client-card";
import { LinkPill } from "./link-pill";

// MobileClientRow — phone rendering of a client in the workspace list
// (SK-54, Gili's mobile audit). The desktop ClientCard (avatar block +
// a 3-column PROJECTS/LIFETIME/OWED stat box) stretched full-width on
// a phone reads as dead space. Premium mobile CRMs (HubSpot, Square,
// Stripe) use tight two-line rows inside one hairline-divided card:
//
//   [avatar+status dot]  name              [invite / actions]
//                        n projects
//
// Link state moves onto the avatar as a status dot (green = linked,
// amber pulse = invited). The "Invite to app" action stays available
// as the row's right-side pill when the client isn't linked yet.

interface MobileClientRowProps {
  client: ClientCardData;
  onInvite?: (client: ClientCardData) => void;
  onEdit?: (client: ClientCardData) => void;
  onArchive?: (client: ClientCardData) => void;
  onActionStart?: (trigger: HTMLButtonElement) => void;
  /** True for every row except the last — renders the hairline. */
  divider: boolean;
}

export function MobileClientRow({
  client,
  onInvite,
  onEdit,
  onArchive,
  onActionStart,
  divider,
}: MobileClientRowProps) {
  const { id, name, archived, linkState, projects } = client;

  // Never surface the email in the list (Gili, round 2) — it's noise
  // at a glance and quietly leaks contact data in over-the-shoulder
  // situations. It lives inside the client page.
  const projectSummary =
    projects > 0
      ? `${String(projects)} ${projects === 1 ? "project" : "projects"}`
      : "No projects yet";
  const showInvite = linkState === "none";

  return (
    <div
      role="listitem"
      className={["min-w-0", divider ? "border-b border-[rgb(var(--border-subtle))]" : ""].join(
        " ",
      )}
    >
      <div className="relative flex min-h-[72px] min-w-0 items-center gap-3 px-3.5 py-2.5">
        <Link
          href={`/dashboard/clients-projects/clients/${id}`}
          className="absolute inset-0 z-10 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
          aria-label={`Open ${name}${linkState === "active" ? ", linked" : linkState === "pending" ? ", invited" : ""}`}
        />

        <span className="relative shrink-0" aria-hidden>
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold text-white"
            style={{ background: producerGradient(name) }}
          >
            {producerInitials(name)}
          </span>
          {linkState !== "none" ? (
            <span
              className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full text-white ring-2 ring-[rgb(var(--bg-elevated))]"
              style={{
                background:
                  linkState === "active"
                    ? "rgb(var(--fg-success-text))"
                    : "rgb(var(--brand-primary-text))",
              }}
              title={linkState === "active" ? "Linked" : "Invited"}
            >
              {linkState === "active" ? (
                <Check size={10} strokeWidth={3} />
              ) : (
                <Clock3 size={9} strokeWidth={2.5} />
              )}
            </span>
          ) : null}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] leading-tight font-semibold text-[rgb(var(--fg-default))]">
            {name}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[rgb(var(--fg-muted))]">
            {projectSummary}
          </p>
        </div>

        <div className="relative z-20 flex shrink-0 items-center gap-1.5 has-[[aria-expanded=true]]:z-30">
          {showInvite && onInvite ? (
            <LinkPill
              state="none"
              onInvite={() => {
                onInvite(client);
              }}
            />
          ) : !onEdit && !onArchive ? (
            <ChevronRight size={16} aria-hidden className="text-[rgb(var(--fg-muted))]" />
          ) : null}
          <ClientActionsMenu
            name={name}
            archived={archived}
            onEdit={
              onEdit
                ? () => {
                    onEdit(client);
                  }
                : undefined
            }
            onArchive={
              onArchive
                ? () => {
                    onArchive(client);
                  }
                : undefined
            }
            onActionStart={onActionStart}
          />
        </div>
      </div>
    </div>
  );
}
