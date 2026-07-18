"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, Mail, Phone, FolderOpen, Calendar, Pencil, ArchiveRestore } from "lucide-react";

import { producerGradient, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import { StatTile } from "~/components/dashboard/common/stat-tile";
import { HeroGlowOrbs } from "~/components/dashboard/common/hero-glow-orbs";
import { useToast } from "~/components/ui/toast";
import { sendClientInviteAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

import { EditClientModal } from "./edit-client-modal";
import { ClientActionsMenu } from "./client-actions-menu";
import { ClientArchiveConfirmModal } from "./client-archive-confirm-modal";
import { InviteToAppModal } from "./invite-modal";
import { LinkPill, type LinkPillState } from "./link-pill";
import { NewProjectModal } from "./new-project-modal";
import { RemoveClientConfirmModal } from "./remove-client-confirm-modal";

// The Client Space hero replaces the old 4-tab header. One big dark
// gradient band: compact avatar tile, eyebrow CLIENT, name + LinkPill
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
  /** Producer-only labels used to organize the roster. */
  tags: string[];
  /** Producer archive state; artist access and history are unaffected. */
  archived: boolean;
  /** Why archive is currently unavailable; restore never uses this. */
  archiveBlockedReason?: string | null;
  /** Exact shared-domain eligibility for permanently deleting an empty draft. */
  canPermanentlyDelete: boolean;
  linkState: LinkPillState;
  /** ISO date string the client was added to the producer's roster. */
  joinedAtIso: string;
  /** Optional human-formatted joined label e.g. "Joined Apr 2026". */
  joinedLabel?: string;
  /** Lifetime spend in cents; null while the purchase payment projection is unavailable. */
  lifetime: number | null;
  /** Outstanding balance in cents; null while the purchase payment projection is unavailable. */
  outstanding: number | null;
  /** Count of active projects. */
  activeProjects: number;
  /** True when commercial totals exist in more than one currency and must not be combined. */
  moneyHasMultipleCurrencies: boolean;
  /** True when the canonical ledger is available but contains no purchases. */
  moneyHasNoPurchases: boolean;
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
  onInvite?: (client: ClientSpaceHeroData) => void;
}

function formatMoney(cents: number, currency: string): string {
  try {
    const withCents = Math.abs(cents) % 100 !== 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: withCents ? 2 : 0,
      maximumFractionDigits: withCents ? 2 : 0,
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

export function ClientSpaceHero({ client, producerSlug, onInvite }: ClientSpaceHeroProps) {
  const {
    id,
    name,
    email,
    phone,
    notes,
    tags,
    archived,
    archiveBlockedReason,
    canPermanentlyDelete,
    linkState,
    joinedAtIso,
    joinedLabel,
    lifetime,
    outstanding,
    activeProjects,
    moneyHasMultipleCurrencies,
    moneyHasNoPurchases,
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

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const actionReturnFocusRef = useRef<HTMLElement | null>(null);

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
      // <md: tighter band padding + stacked layout (the desktop row
      // crushed "Noa Kirel" to "No…" at 390px). md+: original values.
      className="relative -mx-4 border-b px-5 py-5 text-white sm:-mx-6 md:px-8 md:py-7"
      style={{
        background: heroBg(token),
        borderBottomColor: "rgb(var(--border-strong))",
      }}
      aria-label={`Client space for ${name}`}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <HeroGlowOrbs />
      </div>

      <div className="relative mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4 md:gap-5">
        <div className="flex min-w-0 items-center gap-3.5 md:gap-5">
          <span
            className="font-syne flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[18px] text-[24px] font-extrabold text-white md:h-24 md:w-24 md:rounded-[22px] md:text-[36px]"
            style={{
              background: avatarBg,
              boxShadow: "0 18px 40px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.16)",
            }}
            aria-hidden
          >
            {initials}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold tracking-[0.18em] text-white/78 uppercase">
              CLIENT
            </p>
            <div className="my-1 flex flex-wrap items-center gap-2 md:gap-3">
              <h1
                // <md the name wraps up to 2 lines instead of
                // truncating. md+ keeps the one-line 54px crop.
                className="font-syne line-clamp-2 text-[26px] leading-[1.06] font-extrabold tracking-[-0.035em] text-white md:line-clamp-none md:truncate md:text-[44px] md:leading-[0.98]"
                style={{ textShadow: "0 2px 20px rgba(0,0,0,0.25)" }}
              >
                {name}
              </h1>
              {onInvite || canMountInvite ? (
                <LinkPill state={linkState} appearance="hero" onInvite={handlePillInvite} />
              ) : (
                <LinkPill state={linkState} appearance="hero" />
              )}
              {archived ? (
                <span className="rounded-[var(--radius-sm)] border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-bold tracking-[0.12em] text-white/85 uppercase">
                  Archived
                </span>
              ) : null}
            </div>

            <ul className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-white/92">
              {email ? (
                // max-w-full keeps long emails inside the band on
                // phones (they overflowed to the screen edge at 390px).
                <li className="inline-flex max-w-full items-center gap-1.5">
                  <Mail size={12} className="shrink-0" aria-hidden />
                  <span className="truncate">{email}</span>
                </li>
              ) : null}
              {phone ? (
                <li className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                  <Phone size={12} className="shrink-0" aria-hidden />
                  <span className="truncate">{phone}</span>
                </li>
              ) : null}
              {/* SK-64 — both items are duplicated by the stat strip
                  60px below ("Active projects" / "Joined" tiles), so
                  on phones they only added meta lines. md+ keeps them
                  (the desktop strip sits further away). */}
              <li className="hidden items-center gap-1.5 md:inline-flex">
                <FolderOpen size={12} aria-hidden />
                <span>
                  {activeProjects} active {activeProjects === 1 ? "project" : "projects"}
                </span>
              </li>
              <li className="hidden items-center gap-1.5 md:inline-flex">
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
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ background: "rgb(var(--brand-primary))" }}
                />
                <span>
                  Invitation sent &middot;{" "}
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendPending}
                    className="font-semibold text-white underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:opacity-50"
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

        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:flex md:w-auto md:shrink-0 md:self-end">
          <button
            ref={primaryActionRef}
            type="button"
            onClick={() => {
              actionReturnFocusRef.current = primaryActionRef.current;
              if (archived) {
                setArchiveOpen(true);
              } else if (!email) {
                setEditOpen(true);
              } else {
                setNewProjectOpen(true);
              }
            }}
            // Solid-white primary pill — G14: the client hero's only
            // primary CTA should match the design's `btn-light`
            // (background:#fff; color:#111009) for max prominence.
            // <md it stretches full-width at a 44px touch height.
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-white px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none md:min-h-[36px] md:flex-none md:justify-start md:rounded-[var(--radius-md)]"
            style={{ color: "rgb(var(--bg-sidebar))" }}
          >
            {archived ? (
              <ArchiveRestore size={14} aria-hidden />
            ) : !email ? (
              <Pencil size={14} aria-hidden />
            ) : (
              <Plus size={14} aria-hidden />
            )}
            {archived ? "Restore client" : !email ? "Add email" : "New project"}
          </button>

          <ClientActionsMenu
            name={name}
            archived={archived}
            appearance="hero"
            showLabel
            onEdit={() => {
              setEditOpen(true);
            }}
            onArchive={
              archived
                ? undefined
                : () => {
                    setArchiveOpen(true);
                  }
            }
            onDelete={
              canPermanentlyDelete
                ? () => {
                    setRemoveOpen(true);
                  }
                : undefined
            }
            onActionStart={(trigger) => {
              actionReturnFocusRef.current = trigger;
            }}
          />
        </div>
      </div>

      <div className="relative mx-auto mt-5 grid max-w-[1100px] grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--border-subtle))] md:mt-6 md:grid-cols-4 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent">
        <StatTile
          mobileCompact
          label="Lifetime"
          value={
            moneyHasMultipleCurrencies
              ? "See below"
              : moneyHasNoPurchases
                ? "No purchases"
                : lifetime === null
                  ? "Unavailable"
                  : formatMoney(lifetime, currency)
          }
        />
        <StatTile
          mobileCompact
          label="Outstanding"
          value={
            moneyHasMultipleCurrencies
              ? "See below"
              : moneyHasNoPurchases
                ? "—"
                : outstanding === null
                  ? "Unavailable"
                  : outstanding > 0
                    ? formatMoney(outstanding, currency)
                    : "—"
          }
          variant={outstanding !== null && outstanding > 0 ? "danger" : "default"}
        />
        <StatTile mobileCompact label="Active projects" value={activeProjects} />
        <StatTile mobileCompact label="Joined" value={joined} />
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
          tags,
        }}
        returnFocusRef={actionReturnFocusRef}
      />

      <ClientArchiveConfirmModal
        open={archiveOpen}
        onClose={() => {
          setArchiveOpen(false);
        }}
        client={{ id, name, archived }}
        blockedReason={archiveBlockedReason ?? null}
        returnFocusRef={actionReturnFocusRef}
      />

      {canPermanentlyDelete ? (
        <RemoveClientConfirmModal
          open={removeOpen}
          onClose={() => {
            setRemoveOpen(false);
          }}
          client={{ id, name }}
          returnFocusRef={actionReturnFocusRef}
        />
      ) : null}
    </section>
  );
}
