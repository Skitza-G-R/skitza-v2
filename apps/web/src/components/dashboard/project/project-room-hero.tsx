"use client";

// Spotify-style hero header for the Project Room.
// Renders above the page body and sits at full bleed (its parent
// must NOT impose a narrow max-width on it). The gradient color is
// derived from the project's id, so the same project always lands
// on the same swatch — gives every project a recognizable identity.
//
// The hero owns:
//   • Back link (text-only, white-on-color)
//   • Breadcrumbs (light variant)
//   • Folder badge (110×110 dark glass square)
//   • Eyebrow + display title + info row
//   • Play latest / Share / 3-dot kebab actions

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CancelConfirmModal } from "~/components/project/cancel-confirm-modal";
import { ConfirmChargeModal } from "~/components/project/confirm-charge-modal";
import { useToast } from "~/components/ui/toast";
import { useHotkey } from "~/lib/keyboard/use-shortcuts";
import { gradientCss, gradientFor } from "~/lib/project-gradient";
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
} from "~/app/(app)/dashboard/projects/actions";

export type ProjectHeroProject = {
  id: string;
  title: string;
  stage: Stage;
  artistName: string;
  artistEmail: string;
  // Counts driving the info row. Zero is fine — we render "0 songs"
  // / "0 sessions" rather than hiding the slot, because consistency
  // across rooms beats the small win of skipping zeroes.
  trackCount: number;
  sessionCount: number;
  // Total contracted amount in cents. Hidden if null (legacy rows).
  totalAmountCents: number | null;
  currency: string;
  paymentPlanKind: string | null;
  installments: number | null;
  chargesCompleted: number;
  chargesTotal: number | null;
  finalPaid: boolean;
  cardLast4: string | null;
  // First track id (if any) — drives the "Play latest" CTA.
  firstTrackId: string | null;
};

export function ProjectRoomHero({ project }: { project: ProjectHeroProject }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [stage, setStage] = useState<Stage>(project.stage);
  const [finalPaid, setFinalPaid] = useState(project.finalPaid);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);

  // Outside-click + Esc dismiss for the kebab menu — same pattern the
  // prior ProjectHeader used. Kept simple to avoid pulling in Radix
  // for a 4-item menu.
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
  const grad = gradientFor(project.id);

  // ─── Money/stage handlers — preserved verbatim from ProjectHeader ─

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

  // Hotkeys preserved from ProjectHeader.
  useHotkey("t", () => {
    if (isTerminalStage(stage)) return;
    onMarkFinalClick();
  });
  useHotkey("e", () => {
    const el = document.getElementById(
      "project-hero-stage-select",
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

  return (
    <>
      <div
        // Note: `text-white` deliberately — the hero gradient swatches
        // are mid-saturation, so white text reads cleanly across all 8
        // gradient buckets without per-grad luminance branching.
        className="reveal-up relative isolate -mt-px text-white"
        style={{ background: gradientCss(grad) }}
      >
        {/* Subtle dark overlay for legibility on the lighter (amber/lime) gradients */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[rgb(0_0_0/0.10)]"
        />

        <div className="relative mx-auto max-w-[1400px] px-4 pb-8 pt-7 sm:px-6 sm:pt-9 lg:px-8">
          {/* Top row — back link + breadcrumb */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/dashboard/projects"
              className="sk-pop inline-flex items-center gap-1.5 rounded-full bg-[rgb(255_255_255/0.14)] px-3 py-1.5 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-white backdrop-blur-sm transition-colors hover:bg-[rgb(255_255_255/0.22)]"
            >
              <ArrowLeftIcon /> All Projects
            </Link>

            <ol className="flex flex-wrap items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-[rgb(255_255_255/0.78)]">
              <li>
                <Link
                  href="/dashboard/projects"
                  className="hover:text-white"
                >
                  Clients &amp; Projects
                </Link>
              </li>
              <li aria-hidden>›</li>
              <li className="truncate text-white">{project.title}</li>
            </ol>
          </div>

          {/* Main row — folder badge + title + actions */}
          <div className="flex flex-wrap items-end gap-5">
            {/* Folder badge */}
            <div
              aria-hidden
              className="grid h-24 w-24 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-[rgb(0_0_0/0.18)] shadow-[0_12px_32px_rgb(0_0_0/0.28)] sm:h-28 sm:w-28"
            >
              <FolderIcon />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[rgb(255_255_255/0.82)]">
                Project · {STAGE_LABEL[stage]}
              </p>
              <h1
                className="mt-1 truncate font-display text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl"
                style={{
                  textShadow: "0 2px 14px rgb(0 0 0 / 0.18)",
                  lineHeight: 1.05,
                }}
              >
                {project.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-[rgb(255_255_255/0.92)]">
                <span className="inline-flex items-center gap-1.5">
                  <UserIcon /> {project.artistName}
                </span>
                <Dot />
                <span>
                  <span className="font-mono tabular-nums">
                    {project.trackCount.toString()}
                  </span>{" "}
                  song{project.trackCount === 1 ? "" : "s"}
                </span>
                <Dot />
                <span>
                  <span className="font-mono tabular-nums">
                    {project.sessionCount.toString()}
                  </span>{" "}
                  session{project.sessionCount === 1 ? "" : "s"}
                </span>
                {project.totalAmountCents !== null ? (
                  <>
                    <Dot />
                    <span className="font-mono font-semibold tabular-nums">
                      {formatMoney(project.totalAmountCents, project.currency)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {project.firstTrackId ? (
                <Link
                  href={`/dashboard/projects/${project.id}?tab=music&track=${project.firstTrackId}`}
                  className="sk-pop inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[0.85rem] font-bold text-[rgb(var(--fg-primary))] shadow-[0_6px_18px_rgb(0_0_0/0.24)] transition-transform hover:brightness-105"
                >
                  <PlayIcon /> Play latest
                </Link>
              ) : null}

              {!isTerminal ? (
                <>
                  <select
                    id="project-hero-stage-select"
                    value={stage}
                    onChange={(e) => {
                      const next = e.target.value;
                      const ok = (SELECTABLE_STAGES as readonly string[]).includes(
                        next,
                      );
                      if (ok) onStageChange(next as Stage);
                    }}
                    disabled={pending}
                    aria-label="Change stage"
                    className="h-11 rounded-full border border-[rgb(255_255_255/0.28)] bg-[rgb(255_255_255/0.16)] px-4 text-[0.78rem] font-bold text-white backdrop-blur-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-[rgb(255_255_255/0.4)]"
                  >
                    {SELECTABLE_STAGES.map((s) => (
                      <option
                        key={s}
                        value={s}
                        className="bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))]"
                      >
                        Stage: {STAGE_LABEL[s]}
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
                onCancelProject={onCancelClick}
              />
            </div>
          </div>
        </div>
      </div>

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
          clientName={project.artistName}
          amountCents={finalAmountCents}
          currency={project.currency}
          {...(project.cardLast4 ? { cardLast4: project.cardLast4 } : {})}
          onConfirm={onConfirmCharge}
          onClose={() => {
            setChargeOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

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
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  finalPaid: boolean;
  isTerminal: boolean;
  pending: boolean;
  onMarkFinal: () => void;
  onUploadTrack: () => void;
  onCancelProject: () => void;
}) {
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Project actions"
        onClick={() => {
          onOpenChange(!open);
        }}
        disabled={pending}
        className="sk-pop inline-flex h-11 w-11 items-center justify-center rounded-full border border-[rgb(255_255_255/0.28)] bg-[rgb(255_255_255/0.16)] text-white backdrop-blur-sm transition-colors hover:bg-[rgb(255_255_255/0.26)] disabled:opacity-60"
      >
        <span aria-hidden="true" className="font-mono text-base leading-none">
          ⋮
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          style={{ transformOrigin: "top right" }}
          className="sk-pop absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] shadow-lg"
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

function Dot() {
  return <span aria-hidden className="text-[rgb(255_255_255/0.5)]">·</span>;
}

function ArrowLeftIcon() {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  );
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
