"use client";

import Link from "next/link";
import { Plus, Mail, Phone, FolderOpen, Calendar } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import { StatTile } from "~/components/dashboard/common/stat-tile";

import { LinkPill, type LinkPillState } from "./link-pill";

// The Client Space hero replaces the old 4-tab header. One big dark
// gradient band: 112px avatar tile, eyebrow CLIENT, name + LinkPill
// inline, meta strip (email · phone · projects · joined date), then a
// 4-tile stats row (Lifetime · Outstanding · Active projects · Joined).
// Right-side "+ New project" pill links to the new-project form.

export interface ClientSpaceHeroData {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkState: LinkPillState;
  /** ISO date string the client was added to the producer's roster. */
  joinedAtIso: string;
  /** Optional human-formatted joined label e.g. "Joined Apr 2026". */
  joinedLabel?: string;
  /** Lifetime spend in cents. */
  lifetime: number;
  /** Outstanding balance in cents. */
  outstanding: number;
  /** Count of active projects. */
  activeProjects: number;
  /** Currency code — defaults to USD. */
  currency?: string;
  /** Href for the "+ New project" CTA. */
  newProjectHref: string;
}

interface ClientSpaceHeroProps {
  client: ClientSpaceHeroData;
  onInvite?: (client: ClientSpaceHeroData) => void;
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

function formatJoinedFallback(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ClientSpaceHero({
  client,
  onInvite,
}: ClientSpaceHeroProps) {
  const {
    id: _id,
    name,
    email,
    phone,
    linkState,
    joinedAtIso,
    joinedLabel,
    lifetime,
    outstanding,
    activeProjects,
    currency = "USD",
    newProjectHref,
  } = client;
  void _id; // captured for parent identification flows; not rendered

  const initials = producerInitials(name);
  const avatarBg = producerGradient(name);
  const token = deriveGradient(name);
  const joined = joinedLabel ?? formatJoinedFallback(joinedAtIso);

  return (
    <section
      className="relative overflow-hidden rounded-[var(--radius-lg)] px-6 py-7 text-white"
      style={{ background: heroBg(token) }}
      aria-label={`Client space for ${name}`}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-5">
          <span
            className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[28px] font-bold text-white shadow-[var(--shadow-md)]"
            style={{ background: avatarBg }}
            aria-hidden
          >
            {initials}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
              CLIENT
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <h1 className="truncate font-syne text-[28px] font-bold leading-tight text-white">
                {name}
              </h1>
              {onInvite ? (
                <LinkPill
                  state={linkState}
                  onInvite={() => { onInvite(client); }}
                />
              ) : (
                <LinkPill state={linkState} />
              )}
            </div>

            <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-white/70">
              {email ? (
                <li className="inline-flex items-center gap-1.5">
                  <Mail size={12} aria-hidden />
                  <span className="truncate">{email}</span>
                </li>
              ) : null}
              {phone ? (
                <li className="inline-flex items-center gap-1.5">
                  <Phone size={12} aria-hidden />
                  <span>{phone}</span>
                </li>
              ) : null}
              <li className="inline-flex items-center gap-1.5">
                <FolderOpen size={12} aria-hidden />
                <span>
                  {activeProjects} active{" "}
                  {activeProjects === 1 ? "project" : "projects"}
                </span>
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Calendar size={12} aria-hidden />
                <span>{joined}</span>
              </li>
            </ul>
          </div>
        </div>

        <Link
          href={newProjectHref}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-[13px] font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Plus size={14} />
          New project
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Lifetime"
          value={formatMoney(lifetime, currency)}
        />
        <StatTile
          label="Outstanding"
          value={outstanding > 0 ? formatMoney(outstanding, currency) : "—"}
          variant={outstanding > 0 ? "danger" : "default"}
        />
        <StatTile label="Active projects" value={activeProjects} />
        <StatTile label="Joined" value={joined} />
      </div>
    </section>
  );
}
