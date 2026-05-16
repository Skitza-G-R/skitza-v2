"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Plus,
  Mail,
  Phone,
  FolderOpen,
  Calendar,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import { StatTile } from "~/components/dashboard/common/stat-tile";
import { HeroGlowOrbs } from "~/components/dashboard/common/hero-glow-orbs";
import { useToast } from "~/components/ui/toast";
import { sendClientInviteAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

import { EditClientModal } from "./edit-client-modal";
import { InviteToAppModal } from "./invite-modal";
import { LinkPill, type LinkPillState } from "./link-pill";
import {
  NewProjectModal,
  type NewProjectModalProductOption,
} from "./new-project-modal";
import { RemoveClientConfirmModal } from "./remove-client-confirm-modal";

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
  /** Free-text producer notes — surfaced in the Edit Client modal. */
  notes: string | null;
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
    notes,
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

  // Inline "Resend invite link" affordance — matches the HTML mockup's
  // hero meta line for `pending` clients. Re-runs sendClientInviteAction
  // with via='email'; same shape as the InviteToAppModal email path so
  // the producer doesn't have to open the modal just to resend.
  const { toast } = useToast();
  const [resendPending, startResendTransition] = useTransition();
  const handleResend = () => {
    startResendTransition(async () => {
      const res = await sendClientInviteAction({ id, via: "email" });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Invite re-sent", "success");
    });
  };

  // PR #130 — kebab menu wiring (Edit details / Remove client). Hand-
  // rolled rather than reaching for Radix DropdownMenu so we can keep
  // the wrapper count low and match the in-house ChangeStageMenu pattern
  // (Status stat tile). The menu closes on outside-click and Escape;
  // the trigger is `aria-expanded`-aware.
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

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

            {/* Inline link-state line — DESIGN.md hero meta row, third
                children. For pending clients, surface a one-click
                "Resend invite link" so producers don't have to re-open
                the invite modal. For active clients, a quiet "Active in
                artist app" affirmation. The LinkPill itself sits next
                to the h1 above; this line adds the verb. */}
            {linkState === "pending" ? (
              <p className="mt-2 inline-flex items-center gap-2 text-[12px] text-white/78">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ background: "rgb(var(--brand-primary))" }}
                />
                <span>Invitation sent &middot;{" "}
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendPending}
                    className="font-semibold text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
                  >
                    {resendPending ? "Resending…" : "Resend invite link"}
                  </button>
                </span>
              </p>
            ) : linkState === "active" ? (
              <p className="mt-2 inline-flex items-center gap-2 text-[12px] text-white/78">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "rgb(var(--fg-success))" }}
                />
                Active in artist app
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end">
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
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            style={{ color: "rgb(var(--bg-sidebar))" }}
          >
            <Plus size={14} />
            New project
          </button>

          {/* PR #130 — kebab menu with Edit / Remove. Frosted-glass
              icon-only trigger so it reads as a secondary action next
              to the solid "+ New project" primary. */}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => { setMenuOpen((v) => !v); }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Client actions"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <MoreVertical size={16} strokeWidth={2.2} />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                aria-label="Client actions menu"
                className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[180px] overflow-hidden rounded-[10px] border bg-[rgb(var(--bg-background))] py-1 text-[13px] shadow-[0_18px_40px_-12px_rgba(17,16,9,0.32)]"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setEditOpen(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[rgb(var(--fg-default))] hover:bg-[rgb(17_16_9/0.06)] focus-visible:bg-[rgb(17_16_9/0.06)] focus-visible:outline-none"
                >
                  <Pencil size={14} strokeWidth={2.2} aria-hidden />
                  Edit details
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRemoveOpen(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)] focus-visible:bg-[rgb(var(--fg-danger)/0.08)] focus-visible:outline-none"
                >
                  <Trash2 size={14} strokeWidth={2.2} aria-hidden />
                  Remove client
                </button>
              </div>
            ) : null}
          </div>
        </div>
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

      <EditClientModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
        }}
        client={{
          id,
          name,
          email: email ?? "",
          phone,
          notes,
        }}
      />

      <RemoveClientConfirmModal
        open={removeOpen}
        onClose={() => {
          setRemoveOpen(false);
        }}
        client={{ id, name }}
      />
    </section>
  );
}
