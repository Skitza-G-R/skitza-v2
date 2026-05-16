"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { setTrackStageAction } from "~/app/(producer)/dashboard/clients-projects/upload-actions";
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
// We don't depend on @radix-ui/react-dropdown-menu (not installed in
// this repo) — instead we implement a tight click-outside-to-close
// menu with focus management + ESC handling. Compatible with the rest
// of the Skitza UI primitives.
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

export function ChangeStageMenu({ trackId, current }: ChangeStageMenuProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Optimistic state — flip immediately on click so the trigger label
  // updates while the Server Action is in flight. Reverted in the
  // catch branch if the mutation fails.
  const [optimistic, setOptimistic] = useState<WorkflowStage | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape. We attach a single listener for
  // each so we don't pay the cost when the menu is closed.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handlePick = useCallback(
    (next: WorkflowStage) => {
      if (next === (optimistic ?? current)) {
        setOpen(false);
        return;
      }
      setOptimistic(next);
      setOpen(false);
      startTransition(async () => {
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
      });
    },
    [current, optimistic, toast, trackId, router],
  );

  const displayed: WorkflowStage = optimistic ?? current;
  const hue = stageColor(displayed);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        className="sk-press inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest disabled:opacity-60"
        style={{
          color: hue,
          borderColor: hue,
          background: "transparent",
        }}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: hue }}
        />
        {stageLabel(displayed)}
        <ChevronDown size={11} aria-hidden />
      </button>

      {open ? (
        // I3 — we don't implement the full ARIA menu keyboard contract
        // (arrow-key navigation, initial focus on the first item, type-
        // ahead). Honest fix: drop the menu/menuitem roles so we don't
        // claim a pattern we haven't built; treat as a disclosed group
        // of plain buttons. The trigger keeps aria-haspopup +
        // aria-expanded — those are still correct for a disclosed
        // button group.
        <div
          ref={menuRef}
          aria-label="Workflow stage options"
          className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[200px] overflow-hidden rounded-[10px] border bg-[rgb(var(--bg-background))] py-1 shadow-[0_18px_40px_-12px_rgba(17,16,9,0.32)]"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        >
          {WORKFLOW_STAGES.map((s) => {
            const active = s.key === displayed;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  handlePick(s.key);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[rgb(17_16_9/0.06)]"
                style={{ color: "rgb(var(--fg-default))" }}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: stageColor(s.key) }}
                />
                <span className="flex-1 truncate font-medium">{s.label}</span>
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
          })}
        </div>
      ) : null}
    </div>
  );
}
