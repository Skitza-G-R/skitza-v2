"use client";

import { Archive, ArchiveRestore, Ban, Pencil, Trash2 } from "lucide-react";
import { type MouseEvent, type RefObject, useEffect, useRef, useState } from "react";

import { DeleteEmptyProjectDialog } from "./delete-empty-project-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import type { ProjectActionCallbacks, ProjectActionProject } from "./project-action-types";
import {
  ProjectLifecycleDialog,
  type ProjectLifecycleDialogMode,
} from "./project-lifecycle-dialog";

export type {
  ProjectActionCallbacks,
  ProjectActionProject,
  ProjectLifecycleStatus,
  ProjectWorkflowStage,
} from "./project-action-types";

type ProjectDialog = "edit" | "delete" | ProjectLifecycleDialogMode;

export interface ProjectActionControlsProps extends ProjectActionCallbacks {
  project: ProjectActionProject;
  /** Surface is for regular rows/cards; hero uses high-contrast glass controls. */
  appearance?: "surface" | "hero" | "menu" | undefined;
  className?: string | undefined;
  /** Stable destination control used after lifecycle changes unmount this row. */
  lifecycleSuccessFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** Stable overflow trigger used when a menu action opens a dialog. */
  dialogReturnFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** Lets a parent disclosure close before the selected dialog opens. */
  onActionStart?: ((trigger: HTMLButtonElement) => void) | undefined;
}

/**
 * Reusable project actions for list rows and project rooms. Every action is a
 * named 44px text control so it remains discoverable and tappable at 360px.
 * The wrapping parent lets narrow screens add a second line without horizontal
 * overflow.
 */
export function ProjectActionControls({
  project,
  appearance = "surface",
  className,
  lifecycleSuccessFocusRef,
  dialogReturnFocusRef,
  onActionStart,
  onChanged,
  onDeleted,
}: ProjectActionControlsProps) {
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setDialog(null);
  }, [project.id]);

  const archived =
    project.lifecycleStatus === "completed" || project.lifecycleStatus === "canceled";
  const canComplete = project.lifecycleStatus === "active" || project.lifecycleStatus === "paused";
  const canCancel = !archived;

  const openDialog = (event: MouseEvent<HTMLButtonElement>, nextDialog: ProjectDialog) => {
    // Rows may use a full-card navigation layer and drag handlers. Keep a
    // project action from navigating or beginning a row drag.
    event.preventDefault();
    event.stopPropagation();
    returnFocusRef.current = dialogReturnFocusRef?.current ?? event.currentTarget;
    onActionStart?.(event.currentTarget);
    setDialog(nextDialog);
  };

  const handleLifecycleChanged = (projectId: string) => {
    const fallback = lifecycleSuccessFocusRef?.current;
    if (fallback?.isConnected) {
      returnFocusRef.current = fallback;
    }
    onChanged?.(projectId);
  };

  const menu = appearance === "menu";
  const commonClass = menu
    ? "flex min-h-11 w-full items-center gap-2 px-3 text-left text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
    : "sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border px-3 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none";
  const surfaceSecondary =
    "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:ring-[rgb(var(--focus-ring))]";
  const surfacePrimary =
    "border-[rgb(var(--fg-default))] bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-background))] hover:opacity-90 focus-visible:ring-[rgb(var(--focus-ring))]";
  const surfaceDanger =
    "border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.06)] text-[rgb(var(--fg-danger-text))] hover:bg-[rgb(var(--fg-danger)/0.11)] focus-visible:ring-[rgb(var(--focus-ring))]";
  const heroControl =
    "border-white/25 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/70";
  const menuNormal =
    "text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:bg-[rgb(var(--bg-overlay))]";
  const menuDanger =
    "border-t border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-danger-text))] hover:bg-[rgb(var(--fg-danger)/0.08)] focus-visible:bg-[rgb(var(--fg-danger)/0.08)]";

  const normalClass = menu ? menuNormal : appearance === "hero" ? heroControl : surfaceSecondary;
  const primaryClass = menu ? menuNormal : appearance === "hero" ? heroControl : surfacePrimary;
  const dangerClass = menu ? menuDanger : appearance === "hero" ? heroControl : surfaceDanger;

  return (
    <>
      <div
        role="group"
        aria-label={`Actions for ${project.title}`}
        className={[
          menu ? "flex w-full flex-col items-stretch" : "flex max-w-full flex-wrap items-center gap-2",
          className ?? "",
        ].join(" ")}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          data-project-action="edit"
          onClick={(event) => {
            openDialog(event, "edit");
          }}
          className={`${commonClass} ${normalClass}`}
        >
          <Pencil size={14} strokeWidth={2.2} aria-hidden />
          Edit
        </button>

        {canComplete ? (
          <button
            type="button"
            data-project-action="complete"
            onClick={(event) => {
              openDialog(event, "complete");
            }}
            className={`${commonClass} ${primaryClass}`}
          >
            <Archive size={14} strokeWidth={2.2} aria-hidden />
            Complete
          </button>
        ) : null}

        {canCancel ? (
          <button
            type="button"
            data-project-action="cancel"
            onClick={(event) => {
              openDialog(event, "cancel");
            }}
            className={`${commonClass} ${dangerClass}`}
          >
            <Ban size={14} strokeWidth={2.2} aria-hidden />
            Cancel
          </button>
        ) : null}

        {archived ? (
          <button
            type="button"
            data-project-action="reopen"
            onClick={(event) => {
              openDialog(event, "reopen");
            }}
            className={`${commonClass} ${primaryClass}`}
          >
            <ArchiveRestore size={14} strokeWidth={2.2} aria-hidden />
            Reopen
          </button>
        ) : null}

        {project.canDeleteEmptyDraft ? (
          <button
            type="button"
            data-project-action="delete"
            onClick={(event) => {
              openDialog(event, "delete");
            }}
            className={`${commonClass} ${dangerClass}`}
          >
            <Trash2 size={14} strokeWidth={2.2} aria-hidden />
            Delete draft
          </button>
        ) : null}
      </div>

      <EditProjectDialog
        open={dialog === "edit"}
        onClose={() => {
          setDialog(null);
        }}
        project={project}
        onSaved={onChanged}
        returnFocusRef={returnFocusRef}
      />

      {dialog === "complete" || dialog === "cancel" || dialog === "reopen" ? (
        <ProjectLifecycleDialog
          open
          onClose={() => {
            setDialog(null);
          }}
          project={project}
          mode={dialog}
          onChanged={handleLifecycleChanged}
          returnFocusRef={returnFocusRef}
        />
      ) : null}

      <DeleteEmptyProjectDialog
        open={dialog === "delete"}
        onClose={() => {
          setDialog(null);
        }}
        project={project}
        onDeleted={onDeleted}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}
