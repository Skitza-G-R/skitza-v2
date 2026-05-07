"use client";

// Project Room header — sits above the 4 sub-tabs. Composes:
//   • Top row: avatar (artist initials) + client name + stage badge +
//     3-dot actions dropdown.
//   • Middle: <PaymentStatusStrip/> (reused from the old header).
//   • Bottom: 5-step <ProjectTimeline/>.
//
// The 3-dot actions menu is the new home for the destructive and
// money-handling controls that used to sit in the Overview tab:
//   • Mark final delivered   → sets finalPaid=true (runs the confirm
//     modal first for split_50_50 projects with a pending charge).
//   • Upload track           → jumps to ?tab=music&action=upload.
//   • Cancel project         → opens the existing CancelConfirmModal
//     (type-to-confirm + Stripe schedule cancellation).
//
// The stage <select> dropdown is rendered inline in the top row next to
// the badge rather than buried in the dropdown — it's the primary
// control for moving a project through the pipeline.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { CancelConfirmModal } from "~/components/project/cancel-confirm-modal";
import { ConfirmChargeModal } from "~/components/project/confirm-charge-modal";
import { PaymentStatusStrip } from "~/components/project/payment-status-strip";
import { EditProjectModal } from "./edit-project-modal";
import { Label } from "~/components/ui/input";
import { KeyboardHint } from "~/components/ui/keyboard-hint";
import { useToast } from "~/components/ui/toast";
import { useHotkey } from "~/lib/keyboard/use-shortcuts";
import {
  isTerminalStage,
  SELECTABLE_STAGES,
  STAGE_LABEL,
  type Stage,
} from "~/lib/projects/stages";
import {
  cancelProjectAction,
  chargeFinalAction,
  setProjectPaid,
  setStageAction,
} from "~/app/(producer)/dashboard/clients-projects/actions";

import { ProjectTimeline } from "./project-timeline";
import { TagEditor } from "./tag-editor";

export interface ProjectHeaderProject {
  id: string;
  title: string;
  stage: Stage;
  artistName: string;
  artistEmail: string;
  clientName: string | null;
  depositPaid: boolean;
  finalPaid: boolean;
  paymentPlanKind: string | null;
  installments: number | null;
  nextChargeAt: Date | null;
  chargesCompleted: number;
  chargesTotal: number | null;
  totalAmountCents: number | null;
  cardLast4: string | null;
  currency: string;
  // finalDelivered mirrors the legacy finalPaid flag for now — until a
  // dedicated "final delivered" column lands, delivery and final
  // payment collapse to the same thing.
  finalDelivered: boolean;
}

export function ProjectHeader({
  project,
  clientContact,
  tagVocabulary = [],
}: {
  project: ProjectHeaderProject;
  // Batch D — the matching client_contacts row for this project's
  // client, if the lookup found one. Undefined/null on legacy rows
  // with no CRM entry; the header omits the tag strip in that case.
  clientContact?: { id: string; tags: string[] } | null;
  // Distinct set of tags this producer has used across their contacts,
  // sorted by frequency. Feeds the TagEditor autocomplete dropdown.
  tagVocabulary?: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [stage, setStage] = useState<Stage>(project.stage);
  const [finalPaid, setFinalPaid] = useState(project.finalPaid);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the actions menu when the user clicks outside it. Kept simple
  // — a Radix popover would be overkill for three static items.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const isTerminal = isTerminalStage(stage);

  // Task 7 parity — split_50_50 with deposit landed needs a confirm
  // modal before firing the off-session charge. Other plan shapes (or
  // already-paid) flip the flag directly.
  const needsChargeModal =
    project.paymentPlanKind === "split_50_50" &&
    project.chargesCompleted === 1 &&
    !project.finalPaid;

  const finalAmountCents =
    project.totalAmountCents === null ? 0 : Math.floor(project.totalAmountCents / 2);

  function onStageChange(next: Stage) {
    const prev = stage;
    setStage(next);
    startTransition(async () => {
      const res = await setStageAction({ id: project.id, stage: next });
      if (!res.ok) {
        setStage(prev);
        toast(res.error, "error");
        return;
      }
      toast(`Moved to ${STAGE_LABEL[next]}.`, "success");
      router.refresh();
    });
  }

  function onMarkFinalClick() {
    setMenuOpen(false);
    if (finalPaid) {
      // Already marked — flip back via the flag mutation. Rare; mainly a
      // mis-click escape hatch while the full flow beds in.
      startTransition(async () => {
        const res = await setProjectPaid({
          projectId: project.id,
          kind: "final",
          paid: false,
        });
        if (!res.ok) {
          toast(res.error, "error");
          return;
        }
        setFinalPaid(false);
        toast("Final payment flag cleared.", "success");
        router.refresh();
      });
      return;
    }
    if (needsChargeModal) {
      setChargeOpen(true);
      return;
    }
    startTransition(async () => {
      const res = await setProjectPaid({
        projectId: project.id,
        kind: "final",
        paid: true,
      });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      setFinalPaid(true);
      toast("Marked paid. The artist can now download the final.", "success");
      router.refresh();
    });
  }

  function onUploadTrackClick() {
    setMenuOpen(false);
    // Deep-link to the music sub-tab with an action hint. The music
    // sub-tab handles the ?action=upload param (landing Task 6).
    router.push(`/dashboard/clients-projects/${project.id}?tab=music&action=upload`);
  }

  // Batch D — Project Room keyboard shortcuts. Scoped to the header's
  // mount (the Project Room renders one header per page), so they
  // disappear when the producer navigates to another surface.
  //
  //   T → toggle the "final delivered" flag (mark/unmark done)
  //   E → move focus to the stage <select> (primary edit on this page)
  useHotkey("t", () => {
    if (isTerminalStage(stage)) return;
    onMarkFinalClick();
  });
  useHotkey("e", () => {
    const el = document.getElementById(
      "project-header-stage-select",
    ) as HTMLSelectElement | null;
    el?.focus();
  });

  function onCancelClick() {
    setMenuOpen(false);
    setCancelOpen(true);
  }

  function onEditClick() {
    setMenuOpen(false);
    setEditOpen(true);
  }

  async function onConfirmCancel(confirmTitle: string) {
    const res = await cancelProjectAction({ projectId: project.id, confirmTitle });
    if (!res.ok) throw new Error(res.error);
    setCancelOpen(false);
    setStage("archived");
    toast("Project cancelled. Future charges stopped automatically.", "success");
    router.refresh();
  }

  async function onConfirmCharge() {
    const res = await chargeFinalAction({ projectId: project.id });
    if (!res.ok) throw new Error(res.error);
    setChargeOpen(false);
    setFinalPaid(true);
    const flipRes = await setProjectPaid({
      projectId: project.id,
      kind: "final",
      paid: true,
    });
    if (!flipRes.ok) {
      toast(flipRes.error, "error");
    } else {
      toast("Charged. The artist can now download the final.", "success");
    }
    router.refresh();
  }

  // Client display name — used by the ConfirmChargeModal preflight.
  // The visible top-row avatar+name moved to ProjectRoomHero, so the
  // initials helper is gone too. clientName is nullable on older rows;
  // fall back to artistName the producer keyed off.
  const displayName = project.clientName ?? project.artistName;

  return (
    <header className="flex flex-col gap-4">
      {/* 2026-05-07 — slim controls row. The redundant title/eyebrow/
          avatar/displayName from the old top row moved to the gradient
          ProjectRoomHero up the page; keeping them here would render
          the project name twice. What remains is the producer-only
          controls (client tags + stage select + 3-dot actions menu)
          that the hero doesn't expose. The badge with STATE_LABEL is
          also dropped because the StatStrip's "Status" tile already
          shows the same data immediately below this row. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          {clientContact ? (
            <TagEditor
              contactId={clientContact.id}
              initialTags={clientContact.tags}
              vocabulary={tagVocabulary}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Inline stage select — hidden for terminal stages so the
              producer doesn't try to walk back a cancelled project via
              dropdown (use the Cancel button / support instead). */}
          {!isTerminal ? (
            <>
              <Label htmlFor="project-header-stage-select" className="sr-only">
                Change stage
              </Label>
              <select
                id="project-header-stage-select"
                value={stage}
                onChange={(e) => {
                  const next = e.target.value;
                  const isSelectable = (SELECTABLE_STAGES as readonly string[]).includes(next);
                  if (isSelectable) onStageChange(next as Stage);
                }}
                disabled={pending}
                className="h-8 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 text-xs font-medium text-[rgb(var(--fg-primary))]"
                aria-label="Change stage"
              >
                {SELECTABLE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <ActionsMenu
            rootRef={menuRef}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            finalPaid={finalPaid}
            isTerminal={isTerminal}
            pending={pending}
            onMarkFinal={onMarkFinalClick}
            onUploadTrack={onUploadTrackClick}
            onEditProject={onEditClick}
            onCancelProject={onCancelClick}
          />
        </div>
      </div>

      {/* Payment plan strip — hidden for legacy rows without a plan. */}
      <PaymentStatusStrip
        paymentPlanKind={
          project.paymentPlanKind === "full" ||
          project.paymentPlanKind === "split_50_50" ||
          project.paymentPlanKind === "monthly"
            ? project.paymentPlanKind
            : null
        }
        installments={project.installments}
        chargesCompleted={project.chargesCompleted}
        chargesTotal={project.chargesTotal}
        totalAmountCents={project.totalAmountCents}
        currency={project.currency || "USD"}
        nextChargeAt={project.nextChargeAt}
        stage={stage}
      />

      {/* 5-step progress rail. */}
      <ProjectTimeline
        stage={stage}
        chargesCompleted={project.chargesCompleted}
        chargesTotal={project.chargesTotal}
        finalDelivered={project.finalDelivered}
      />

      {/* Modals — mounted lazily so we don't ship the confirm UI until
          it's actually in use. Only mounted on non-terminal projects so
          the button never opens in a no-op state. */}
      {!isTerminal ? (
        <CancelConfirmModal
          open={cancelOpen}
          projectTitle={project.title}
          onConfirm={onConfirmCancel}
          onClose={() => {
            setCancelOpen(false);
          }}
        />
      ) : null}

      {needsChargeModal ? (
        <ConfirmChargeModal
          open={chargeOpen}
          clientName={displayName}
          amountCents={finalAmountCents}
          currency={project.currency}
          {...(project.cardLast4 ? { cardLast4: project.cardLast4 } : {})}
          onConfirm={onConfirmCharge}
          onClose={() => {
            setChargeOpen(false);
          }}
        />
      ) : null}

      <EditProjectModal
        open={editOpen}
        projectId={project.id}
        initialTitle={project.title}
        initialArtistName={project.artistName}
        initialArtistEmail={project.artistEmail}
        onClose={() => {
          setEditOpen(false);
        }}
      />
    </header>
  );
}

// ─── 3-dot actions menu ──────────────────────────────────────────────

interface ActionsMenuProps {
  rootRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  finalPaid: boolean;
  isTerminal: boolean;
  pending: boolean;
  onMarkFinal: () => void;
  onUploadTrack: () => void;
  onEditProject: () => void;
  onCancelProject: () => void;
}

function ActionsMenu({
  rootRef,
  open,
  onOpenChange,
  finalPaid,
  isTerminal,
  pending,
  onMarkFinal,
  onUploadTrack,
  onEditProject,
  onCancelProject,
}: ActionsMenuProps) {
  return (
    <div ref={rootRef} className="relative">
      <KeyboardHint shortcut="T">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Project actions"
          onClick={() => {
            onOpenChange(!open);
          }}
          disabled={pending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--fg-primary))] disabled:opacity-60"
        >
          {/* Three vertical dots */}
          <span aria-hidden="true" className="font-mono text-sm leading-none">
            ⋮
          </span>
        </button>
      </KeyboardHint>
      {open ? (
        <div
          role="menu"
          // Right-aligned dropdown: override the default top-left
          // origin so the scale-in visually springs from the 3-dot
          // trigger sitting to the upper-right of the menu.
          style={{ transformOrigin: "top right" }}
          className="sk-pop absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-lg"
        >
          <MenuItem
            onClick={onMarkFinal}
            disabled={pending}
            label={finalPaid ? "Unmark as delivered" : "Mark final delivered"}
            shortcut="T"
          />
          <MenuItem
            onClick={onUploadTrack}
            disabled={pending}
            label="Upload a new track"
            shortcut="U"
          />
          <MenuItem
            onClick={onEditProject}
            disabled={pending}
            label="Edit project"
          />
          {!isTerminal ? (
            <MenuItem
              onClick={onCancelProject}
              disabled={pending}
              label="Cancel project…"
              destructive
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  label,
  destructive,
  shortcut,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  destructive?: boolean;
  // Optional inline shortcut pill (e.g. "T" for toggle done). Pairs
  // with the matching useHotkey wired up on the ProjectHeader.
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors",
        destructive
          ? "text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]"
          : "text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-sunken))]",
        "disabled:opacity-60",
      ].join(" ")}
    >
      <span>{label}</span>
      {shortcut ? (
        <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-1 font-mono text-[0.62rem] text-[rgb(var(--fg-muted))]">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}
