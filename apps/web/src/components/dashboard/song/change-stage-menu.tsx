"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import { setTrackStageAction } from "~/app/(producer)/dashboard/clients-projects/upload-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import {
  stageColor,
  stageLabel,
  WORKFLOW_STAGES,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";

// ChangeStageMenu — small inline affordance on the Song Space that lets
// the producer advance the workflow stage without uploading anything.
// DESIGN.md §6.4 — "small 'change stage' affordance on song page".
//
// Below the canonical 1024px split, choices open in the shared portaled
// bottom Sheet used by the mobile account menu. Desktop keeps the compact
// anchored disclosure with click-outside and Escape handling.
//
// On selection:
//   1. Fire setTrackStageAction (Server Action wrapping project.setTrackStage)
//   2. Toast success / error
//   3. router.refresh so the stat strip + stepper re-read
//   4. Close the menu

interface ChangeStageMenuProps {
  trackId: string;
  current: WorkflowStage;
}

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

export function ChangeStageMenu({ trackId, current }: ChangeStageMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [pending, startTransition] = useTransition();
  // Optimistic state — flip immediately on click so the trigger label
  // updates while the Server Action is in flight. Reverted in the
  // catch branch if the mutation fails.
  const [optimistic, setOptimistic] = useState<WorkflowStage | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const disclosureId = useId();

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => {
      setIsDesktop(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  const closeWithFocusReturn = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  // The anchored desktop popover owns outside-click and Escape handling.
  // The mobile Sheet handles backdrop dismissal, Escape, focus trapping,
  // and focus return through the shared Radix primitive.
  useEffect(() => {
    if (!open || !isDesktop) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeWithFocusReturn();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKey);
    };
  }, [closeWithFocusReturn, isDesktop, open]);

  const handlePick = useCallback(
    (next: WorkflowStage) => {
      if (next === (optimistic ?? current)) {
        closeWithFocusReturn();
        return;
      }
      if (!online) {
        closeWithFocusReturn();
        toast("Reconnect to change this song’s stage.", "error");
        return;
      }
      setOptimistic(next);
      closeWithFocusReturn();
      startTransition(async () => {
        try {
          const res = await setTrackStageAction({
            trackId,
            workflowStage: next,
          });
          if (!res.ok) {
            // Revert optimistic state on failure.
            setOptimistic(null);
            toast(res.error, "error");
            return;
          }
          toast(`Stage set to ${stageLabel(next)}`, "success");
          router.refresh();
        } catch {
          setOptimistic(null);
          toast("Could not change this song’s stage. Try again.", "error");
        }
      });
    },
    [closeWithFocusReturn, current, online, optimistic, toast, trackId, router],
  );

  const displayed: WorkflowStage = optimistic ?? current;
  const hue = stageColor(displayed);
  const stageOptions = WORKFLOW_STAGES.map((stage) => {
    const active = stage.key === displayed;
    return (
      <button
        key={stage.key}
        type="button"
        onClick={() => {
          handlePick(stage.key);
        }}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[rgb(17_16_9/0.06)] focus-visible:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset lg:min-h-0"
        style={{ color: "rgb(var(--fg-default))" }}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: stageColor(stage.key) }}
        />
        <span className="flex-1 truncate font-medium">{stage.label}</span>
        {active ? (
          <Check
            size={13}
            strokeWidth={2.4}
            className="shrink-0 text-[rgb(var(--brand-primary))]"
            aria-hidden
          />
        ) : null}
      </button>
    );
  });

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (pending) return;
          setOpen((v) => !v);
        }}
        aria-haspopup={isDesktop ? undefined : "dialog"}
        aria-expanded={open}
        aria-controls={open ? disclosureId : undefined}
        aria-disabled={pending}
        className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] font-bold tracking-widest uppercase aria-disabled:opacity-60 lg:min-h-0"
        style={{
          color: hue,
          borderColor: hue,
          background: "transparent",
        }}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: hue }} />
        {stageLabel(displayed)}
        <ChevronDown size={11} aria-hidden />
      </button>

      {open && isDesktop ? (
        // I3 — we don't implement the full ARIA menu keyboard contract
        // (arrow-key navigation, initial focus on the first item, type-
        // ahead). Honest fix: drop the menu/menuitem roles so we don't
        // claim a pattern we haven't built; treat as a disclosed group
        // of plain buttons. The trigger keeps aria-expanded, which is
        // correct for a disclosed button group.
        <div
          ref={menuRef}
          id={disclosureId}
          role="group"
          aria-label="Workflow stage options"
          className="absolute top-[calc(100%+6px)] left-0 z-30 min-w-[200px] overflow-hidden rounded-[10px] border bg-[rgb(var(--bg-background))] py-1 shadow-[0_18px_40px_-12px_rgba(17,16,9,0.32)]"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        >
          {stageOptions}
        </div>
      ) : null}

      <Sheet
        open={open && !isDesktop}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOpen(false);
        }}
      >
        <SheetContent
          side="bottom"
          id={disclosureId}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          className="max-h-[88dvh] w-full gap-0 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
        >
          <SheetTitle className="sr-only">Change workflow stage</SheetTitle>
          <SheetDescription className="sr-only">
            Choose the workflow stage for this song.
          </SheetDescription>
          <div className="w-full p-4 pt-2">
            <div
              role="group"
              aria-label="Workflow stage options"
              className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
            >
              {stageOptions}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
