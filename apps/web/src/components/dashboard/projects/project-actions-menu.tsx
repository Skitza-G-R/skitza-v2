"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";

import {
  ProjectActionControls,
  type ProjectActionCallbacks,
  type ProjectActionProject,
} from "./project-action-controls";

interface ProjectActionsMenuProps extends ProjectActionCallbacks {
  project: ProjectActionProject;
  label?: string | undefined;
  lifecycleSuccessFocusRef?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Shared compact project overflow menu. The action controls stay mounted while
 * the popover closes so their confirmation dialogs can open without losing
 * state or their stable return-focus target.
 */
export function ProjectActionsMenu({
  project,
  label,
  lifecycleSuccessFocusRef,
  onChanged,
  onDeleted,
}: ProjectActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const disclosureId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeWithFocusReturn = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [project.id]);

  useEffect(() => {
    if (!open) return;

    rootRef.current?.querySelector<HTMLButtonElement>("[data-project-action]")?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleFocusIn(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeWithFocusReturn();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeWithFocusReturn, open]);

  return (
    <div
      ref={rootRef}
      data-tab-swipe-ignore
      className="relative inline-flex"
      onClick={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-controls={disclosureId}
        aria-haspopup="dialog"
        aria-label={label ?? `Actions for ${project.title}`}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
      >
        <MoreHorizontal size={17} strokeWidth={2.2} aria-hidden />
      </button>

      <div
        id={disclosureId}
        role="dialog"
        aria-modal="false"
        aria-label={`Actions for ${project.title}`}
        data-testid="project-actions-popover"
        hidden={!open}
        className="absolute top-[calc(100%+6px)] right-0 z-40 w-[min(210px,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-md)] border bg-[rgb(var(--bg-background))] py-1 text-[13px] shadow-[0_18px_40px_-12px_rgba(17,16,9,0.32)]"
        style={{ borderColor: "rgb(var(--border-subtle))" }}
      >
        <ProjectActionControls
          project={project}
          appearance="menu"
          dialogReturnFocusRef={triggerRef}
          lifecycleSuccessFocusRef={lifecycleSuccessFocusRef}
          onActionStart={() => {
            setOpen(false);
          }}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      </div>
    </div>
  );
}
