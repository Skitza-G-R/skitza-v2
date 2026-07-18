"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";

import type { ClientCardData } from "./client-card";
import { LinkPill } from "./link-pill";

// MobileClientRow — phone rendering of a client in the workspace list
// (SK-54, Gili's mobile audit). The desktop ClientCard (avatar block +
// a 3-column PROJECTS/LIFETIME/OWED stat box) stretched full-width on
// a phone reads as dead space. Premium mobile CRMs (HubSpot, Square,
// Stripe) use tight two-line rows inside one hairline-divided card:
//
//   [avatar+status dot]  name              [the one number that
//                        n projects · ...   matters: owed]
//
// Link state moves onto the avatar as a status dot (green = linked,
// amber pulse = invited). The "Invite to app" action stays available
// as the row's right-side pill when the client isn't linked yet and
// no known balance needs the right-side slot.

interface MobileClientRowProps {
  client: ClientCardData;
  onInvite?: (client: ClientCardData) => void;
  /** True for every row except the last — renders the hairline. */
  divider: boolean;
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

export function MobileClientRow({
  client,
  onInvite,
  divider,
}: MobileClientRowProps) {
  const { id, name, linkState, projects, lifetime, owed } = client;
  const currency = client.currency ?? "USD";
  const commercialUnavailable = lifetime === null || owed === null;

  // Never surface the email in the list (Gili, round 2) — it's noise
  // at a glance and quietly leaks contact data in over-the-shoulder
  // situations. It lives inside the client page.
  const projectSummary =
    projects > 0
      ? `${String(projects)} ${projects === 1 ? "project" : "projects"}`
      : "No projects yet";
  const secondary = commercialUnavailable
    ? `${projectSummary} · Totals unavailable`
    : `${projectSummary}${lifetime > 0 ? ` · ${formatMoney(lifetime, currency)} lifetime` : ""}`;

  const showInvite = linkState === "none" && (owed === null || owed <= 0);

  return (
    <div
      className={[
        "relative flex min-h-[72px] items-center gap-3 px-3.5 py-2.5",
        divider ? "border-b border-[rgb(var(--border-subtle))]" : "",
      ].join(" ")}
    >
      <Link
        href={`/dashboard/clients-projects/clients/${id}`}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]"
        aria-label={`Open ${name}`}
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
            className={[
              "absolute -bottom-px -right-px h-3 w-3 rounded-full ring-2 ring-[rgb(var(--bg-elevated))]",
              linkState === "pending" ? "animate-pulse" : "",
            ].join(" ")}
            style={{
              background:
                linkState === "active"
                  ? "rgb(var(--fg-success))"
                  : "rgb(var(--brand-primary))",
            }}
            title={linkState === "active" ? "Linked" : "Invited"}
          />
        ) : null}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold leading-tight text-[rgb(var(--fg-default))]">
          {name}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-[rgb(var(--fg-muted))]">
          {secondary}
        </p>
      </div>

      {owed !== null && owed > 0 ? (
        <div className="shrink-0 text-right">
          <p className="font-mono text-[13px] font-bold tabular-nums text-[rgb(var(--fg-danger))]">
            {formatMoney(owed, currency)}
          </p>
          <p className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
            Owed
          </p>
        </div>
      ) : showInvite && onInvite ? (
        <div className="relative z-20 shrink-0">
          <LinkPill
            state="none"
            onInvite={() => {
              onInvite(client);
            }}
          />
        </div>
      ) : (
        <ChevronRight
          size={16}
          aria-hidden
          className="shrink-0 text-[rgb(var(--fg-muted))]"
        />
      )}
    </div>
  );
}
