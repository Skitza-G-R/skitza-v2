"use client";

// Project Room header — orchestrating component for the page-top
// surface above the sub-tabs. Composes:
//   • <ProjectHero/>           — gradient album-style hero with
//                                title, action pills, and the kebab.
//   • <ProjectStatusStrip/>    — 4 at-a-glance tiles (Stage / Progress
//                                / Next charge / Outstanding).
//   • <PaymentStatusStrip/>    — payment-plan detail strip (split or
//                                monthly only; renders null on full).
//
// State + side effects (kebab open/close, stage select, modals,
// hotkeys, server-action wiring) all live here. The presentational
// pieces (ProjectHero, ProjectStatusStrip) are stateless so they can
// be restyled without dragging the orchestration along.
//
// Workflow rail (<ProjectTimeline/>) moved to the Overview sub-tab in
// the 2026-05 redesign — it's now the heart of the "Workflow" card.
//
// 3-dot menu actions (Mark final delivered / Upload track / Cancel
// project) keep their previous wiring: the kebab opens a small
// dropdown, click-outside + Esc close it, and individual items either
// fire a server action or open a confirm modal.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { CancelConfirmModal } from "~/components/project/cancel-confirm-modal";
import { ConfirmChargeModal } from "~/components/project/confirm-charge-modal";
import { PaymentStatusStrip } from "~/components/project/payment-status-strip";
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
import { STATE_LABEL, stageToState } from "~/lib/projects/states";
import {
  cancelProjectAction,
  chargeFinalAction,
  setProjectPaid,
  setStageAction,
} from "~/app/(app)/dashboard/projects/actions";
import type { GradientKey } from "~/lib/projects/gradient";

import { ProjectHero } from "./project-hero";
import { ProjectStatusStrip } from "./project-status-strip";
import {
  computeTimeline,
  type ProjectTimelineInput,
} from "./timeline-helpers";

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
  // Task 5 timeline signal — true when at least one contract has been
  // signed for this project.
  contractSigned: boolean;
  // Mirrors finalPaid until a dedicated "delivered" column lands.
  finalDelivered: boolean;
}

export function ProjectHeader({
  project,
  // Tag editor disappeared from the visible header in the 2026-05
  // redesign — it surfaces on the Overview tab's Client card instead.
  // Props kept for backward-compat with the existing page.tsx call
  // shape; they're forwarded to nothing here. Remove once page.tsx
  // stops passing them.
  gradientClass,
  songsCount,
  sessionsCount,
  hasVersions,
  outstandingCents,
}: {
  project: ProjectHeaderProject;
  // Per-project hero gradient (deterministic from project id).
  // Computed by the server page using gradientForId(id).
  gradientClass: GradientKey;
  // Counts for the hero meta strip — passed in rather than derived
  // here because the orchestrator already loads them server-side.
  songsCount: number;
  sessionsCount: number;
  // Whether any version exists across the project's tracks. Drives
  // the visibility of the "Play latest" pill.
  hasVersions: boolean;
  // Outstanding balance for the StatusStrip — page.tsx loads this
  // from caller.project.money() once per render, so we pass the
  // already-loaded value rather than re-fetching here.
  outstandingCents: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [stage, setStage] = useState<Stage>(project.stage);
  const [finalPaid, setFinalPaid] = useState(project.finalPaid);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);

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
    router.push(`/dashboard/projects/${project.id}?tab=music&action=upload`);
  }

  // Project Room keyboard shortcuts:
  //   T → toggle the "final delivered" flag (mark/unmark done)
  //   E → move focus to the stage <select> in the hero
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

  async function onConfirmCancel(confirmTitle: string) {
    const res = await cancelProjectAction({ projectId: project.id, confirmTitle });
    if (!res.ok) throw new Error(res.error);
    setCancelOpen(false);
    setStage("cancelled");
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

  // ─── Derived strings + props for child components ──────────────────

  const displayClient = project.clientName ?? project.artistName;
  const stateLabel = STATE_LABEL[stageToState(stage)];
  const stageDetail = STAGE_LABEL[stage];

  // Eyebrow over the hero title — lifts the high-level state, not the
  // fine-grained stage. "Project · In production" reads cleaner than
  // "Project · Mixing v3".
  const eyebrow = `Project · ${stateLabel}`;

  // Meta strip — joined with center-dots in ProjectHero. Drop falsy
  // entries so a project with no tracks doesn't show "0 songs".
  const meta: string[] = [];
  meta.push(displayClient);
  if (songsCount > 0) {
    meta.push(`${String(songsCount)} ${songsCount === 1 ? "song" : "songs"}`);
  }
  if (sessionsCount > 0) {
    meta.push(
      `${String(sessionsCount)} ${sessionsCount === 1 ? "session" : "sessions"}`,
    );
  }
  if (project.totalAmountCents && project.totalAmountCents > 0) {
    meta.push(formatMoney(project.totalAmountCents, project.currency));
  }

  const playLatestHref = hasVersions
    ? `/dashboard/projects/${project.id}?tab=music`
    : null;

  // Progress for the StatusStrip. Reuse the same computeTimeline used
  // by the workflow card so the percent and the rail tell the same
  // story; no risk of the strip showing 60% while the rail shows 4/5.
  const timelineInput: ProjectTimelineInput = {
    stage,
    contractSigned: project.contractSigned,
    chargesCompleted: project.chargesCompleted,
    chargesTotal: project.chargesTotal,
    finalDelivered: finalPaid,
  };
  const timelineSteps = computeTimeline(timelineInput);
  const doneCount = timelineSteps.filter((s) => s.state === "done").length;
  const progressPercent = (doneCount / timelineSteps.length) * 100;

  return (
    <header className="flex flex-col gap-4">
      <ProjectHero
        title={project.title}
        eyebrow={eyebrow}
        meta={meta}
        gradientClass={gradientClass}
        playLatestHref={playLatestHref}
        stageSelectSlot={
          !isTerminal ? (
            <>
              <Label
                htmlFor="project-header-stage-select"
                className="sr-only"
              >
                Change stage
              </Label>
              <select
                id="project-header-stage-select"
                value={stage}
                onChange={(e) => {
                  const next = e.target.value;
                  const isSelectable = (
                    SELECTABLE_STAGES as readonly string[]
                  ).includes(next);
                  if (isSelectable) onStageChange(next as Stage);
                }}
                disabled={pending}
                // Pill-shaped select that reads on the gradient: white
                // border + translucent fill + white text. The native
                // dropdown popover keeps system styling — that's fine,
                // OS chrome wins for accessibility.
                className="h-8 rounded-full border border-white/40 bg-white/15 px-3 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Change stage"
              >
                {SELECTABLE_STAGES.map((s) => (
                  <option
                    key={s}
                    value={s}
                    // System dropdown text uses the OS color, but we
                    // still set a fallback so the option text reads
                    // when ChromeOS / Linux render flat-styled options.
                    className="text-[rgb(var(--fg-primary))]"
                  >
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </>
          ) : null
        }
        extraActions={
          <ActionsMenu
            rootRef={menuRef}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            finalPaid={finalPaid}
            isTerminal={isTerminal}
            pending={pending}
            onMarkFinal={onMarkFinalClick}
            onUploadTrack={onUploadTrackClick}
            onCancelProject={onCancelClick}
          />
        }
      />

      <ProjectStatusStrip
        stateLabel={stateLabel}
        stageDetail={stageDetail}
        progressPercent={progressPercent}
        nextChargeAt={project.nextChargeAt}
        outstandingCents={outstandingCents}
        currency={project.currency || "USD"}
      />

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
          clientName={displayClient}
          amountCents={finalAmountCents}
          currency={project.currency}
          {...(project.cardLast4 ? { cardLast4: project.cardLast4 } : {})}
          onConfirm={onConfirmCharge}
          onClose={() => {
            setChargeOpen(false);
          }}
        />
      ) : null}
    </header>
  );
}

// ─── 3-dot actions menu (rendered into ProjectHero's extraActions) ──

interface ActionsMenuProps {
  rootRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  finalPaid: boolean;
  isTerminal: boolean;
  pending: boolean;
  onMarkFinal: () => void;
  onUploadTrack: () => void;
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
          // Trigger lives ON the gradient hero so it gets the same
          // translucent-white pill treatment as the Share button.
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
        >
          <span aria-hidden="true" className="font-mono text-base leading-none">
            ⋮
          </span>
        </button>
      </KeyboardHint>
      {open ? (
        <div
          role="menu"
          // Right-aligned dropdown under the trigger; fade-scale origin
          // pinned to top-right so the menu visibly springs from the
          // trigger pill.
          style={{ transformOrigin: "top right" }}
          className="sk-pop absolute right-0 top-11 z-20 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] shadow-lg"
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

// ─── Local helper ─────────────────────────────────────────────────────

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
