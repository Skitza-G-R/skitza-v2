"use client";

import { useState } from "react";
import { Plus, Mail, Phone, FolderOpen, Calendar } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import { StatTile } from "~/components/dashboard/common/stat-tile";
import { HeroGlowOrbs } from "~/components/dashboard/common/hero-glow-orbs";

import { InviteToAppModal } from "./invite-modal";
import { LinkPill, type LinkPillState } from "./link-pill";
import {
  NewProjectModal,
  type NewProjectModalProductOption,
} from "./new-project-modal";

// The Client Space hero replaces the old 4-tab header. One big dark
// gradient band: 112px avatar tile, eyebrow CLIENT, name + LinkPill
// inline, meta strip (email · phone · projects · joined date), then a
// 4-tile stats row (Lifetime · Outstanding · Active projects · Joined).
// Right-side "+ New project" pill links to the new-project form.
//
// Phase 1 Task 17 — the hero owns the InviteToAppModal mount (same
// pattern as WorkspaceListView). When LinkPill is in the "none" state
// and producerSlug is provided, clicking the pill opens the modal. The
// modal lives inside this component so the page doesn't have to weave
// callbacks through.

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
}

interface ClientSpaceHeroProps {
  client: ClientSpaceHeroData;
  /** Producer slug — needed by the inline InviteToAppModal to build the
   *  public invite URL. When provided, the LinkPill's "none" state
   *  opens the modal automatically; an explicit onInvite override still
   *  takes precedence for callers that want to handle the click. */
  producerSlug?: string;
  /** Producer's active store products. Forwarded to NewProjectModal so
   *  the "+ New project" pill can drive the product picker. Pass `[]`
   *  if the producer hasn't set up products yet — the modal renders an
   *  empty-state hint linking to /dashboard/store in that case. */
  products: NewProjectModalProductOption[];
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
  producerSlug,
  products,
  onInvite,
}: ClientSpaceHeroProps) {
  const {
    id,
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
  } = client;

  // Internal modal state — opens when the LinkPill's "none" state is
  // clicked AND the parent didn't provide an `onInvite` override AND
  // producerSlug is present. We don't open if producerSlug is missing
  // because the invite URL would be malformed.
  const [inviteOpen, setInviteOpen] = useState(false);
  const canMountInvite = !onInvite && producerSlug !== undefined && producerSlug.length > 0;
  const handlePillInvite = () => {
    if (onInvite) {
      onInvite(client);
    } else if (canMountInvite) {
      setInviteOpen(true);
    }
  };
  const closeInvite = () => {
    setInviteOpen(false);
  };

  // Phase 1 G7 — NewProjectModal state. The "+ New project" pill in the
  // hero used to be a <Link> to the legacy /new page; it now opens this
  // modal in `lockedClient` mode so the project is always created
  // against the client whose space we're on.
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const initials = producerInitials(name);
  const avatarBg = producerGradient(name);
  const token = deriveGradient(name);
  const joined = joinedLabel ?? formatJoinedFallback(joinedAtIso);

  return (
    <section
      // Full-bleed dark band — DESIGN.md hero spec line 252. See
      // album-hero.tsx for the same pattern: negative horizontal
      // margins cancel the page padding so the hero stretches to the
      // content-area edges. Stat-tile row sits inside the band, then a
      // hairline bottom border separates it from the projects list.
      className="relative -mx-4 overflow-hidden border-b px-[34px] py-9 pb-7 text-white sm:-mx-6"
      style={{
        background: heroBg(token),
        borderBottomColor: "rgb(var(--border-strong))",
      }}
      aria-label={`Client space for ${name}`}
    >
      <HeroGlowOrbs />

      <div className="relative mx-auto flex max-w-[1100px] flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-end gap-[22px]">
          <span
            className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[24px] font-syne text-[42px] font-extrabold text-white"
            style={{
              background: avatarBg,
              boxShadow:
                "0 18px 40px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.16)",
            }}
            aria-hidden
          >
            {initials}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-white/78">
              CLIENT
            </p>
            <div className="my-1 flex flex-wrap items-center gap-3">
              <h1
                className="truncate font-syne text-[54px] font-extrabold leading-[0.95] tracking-[-0.035em] text-white"
                style={{ textShadow: "0 2px 20px rgba(0,0,0,0.25)" }}
              >
                {name}
              </h1>
              {onInvite || canMountInvite ? (
                <LinkPill state={linkState} onInvite={handlePillInvite} />
              ) : (
                <LinkPill state={linkState} />
              )}
            </div>

            <ul className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-white/92">
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

        <button
          type="button"
          onClick={() => { setNewProjectOpen(true); }}
          disabled={!email}
          title={
            email
              ? undefined
              : "Add an email to this client before creating a project for them."
          }
          // Solid-white primary pill — G14: the client hero's only
          // primary CTA should match the design's `btn-light`
          // (background:#fff; color:#111009) for max prominence.
          className="inline-flex shrink-0 items-center gap-1.5 self-end rounded-full bg-white px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
          style={{ color: "rgb(var(--bg-sidebar))" }}
        >
          <Plus size={14} />
          New project
        </button>
      </div>

      <div className="relative mx-auto mt-6 grid max-w-[1100px] grid-cols-2 gap-3 md:grid-cols-4">
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

      {!onInvite && producerSlug !== undefined && producerSlug.length > 0 ? (
        <InviteToAppModal
          open={inviteOpen}
          onClose={closeInvite}
          client={{
            id,
            name,
            email,
            gradient: avatarBg,
          }}
          producerSlug={producerSlug}
        />
      ) : null}

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => {
          setNewProjectOpen(false);
        }}
        clients={[]}
        products={products}
        lockedClient={{
          id,
          name,
          // The artistEmail snapshot on the project requires a string;
          // a hero-rendered client without an email is a no-go for v1
          // (we won't ever open the modal in lockedClient mode without
          // one), so fall back to an empty string defensively.
          email: email ?? "",
        }}
        onCreated={() => {
          setNewProjectOpen(false);
        }}
      />
    </section>
  );
}
