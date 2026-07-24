"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, type SyntheticEvent, useEffect, useState, useTransition } from "react";

import { updateProjectAction } from "~/app/(producer)/dashboard/clients-projects/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

import {
  PROJECT_WORKFLOW_STAGE_OPTIONS,
  type ProjectActionProject,
  type ProjectWorkflowStage,
} from "./project-action-types";

export interface EditProjectDialogProps {
  open: boolean;
  onClose: () => void;
  project: ProjectActionProject;
  onSaved?: ((projectId: string) => void) | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}

function dateInputValue(deadlineAtIso: string | null): string {
  if (!deadlineAtIso) return "";
  return /^\d{4}-\d{2}-\d{2}/.exec(deadlineAtIso)?.[0] ?? "";
}

export function EditProjectDialog({
  open,
  onClose,
  project,
  onSaved,
  returnFocusRef,
}: EditProjectDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(project.title);
  const [deadline, setDeadline] = useState(dateInputValue(project.deadlineAtIso));
  const [workflowStage, setWorkflowStage] = useState<ProjectWorkflowStage>(project.workflowStage);
  const [titleTouched, setTitleTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(project.title);
    setDeadline(dateInputValue(project.deadlineAtIso));
    setWorkflowStage(project.workflowStage);
    setTitleTouched(false);
  }, [open, project.id, project.title, project.deadlineAtIso, project.workflowStage]);

  const cleanTitle = title.trim();
  const initialDeadline = dateInputValue(project.deadlineAtIso);
  const titleInvalid = titleTouched && cleanTitle.length === 0;
  const hasChanges =
    cleanTitle !== project.title ||
    deadline !== initialDeadline ||
    workflowStage !== project.workflowStage;

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTitleTouched(true);
    if (!cleanTitle || !hasChanges) return;
    if (!online) {
      toast("Reconnect to update this project.", "error");
      return;
    }

    startTransition(async () => {
      const payload: Parameters<typeof updateProjectAction>[0] = {
        id: project.id,
        title: cleanTitle,
        deadlineAtIso: deadline ? new Date(`${deadline}T00:00:00.000Z`).toISOString() : null,
        workflowStage,
      };
      try {
        const result = await updateProjectAction(payload);
        if (!result.ok) {
          toast(result.error, "error");
          return;
        }

        toast("Project updated", "success");
        onSaved?.(project.id);
        router.refresh();
        onClose();
      } catch {
        toast("Could not update this project. Try again.", "error");
      }
    });
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                Edit {project.title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                Update the project details. The client who owns this work cannot be changed.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            <div>
              <FieldLabel htmlFor={`edit-project-title-${project.id}`}>Project name</FieldLabel>
              <input
                id={`edit-project-title-${project.id}`}
                type="text"
                required
                autoFocus
                maxLength={120}
                value={title}
                aria-invalid={titleInvalid}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
                onBlur={() => {
                  setTitleTouched(true);
                }}
                className="mt-1.5 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[14px]"
              />
              {titleInvalid ? (
                <p className="mt-1 text-[12px] text-[rgb(var(--fg-danger-text))]">
                  Enter a project name.
                </p>
              ) : null}
            </div>

            <div>
              <span className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                Client · read-only
              </span>
              <div
                aria-label={`Client: ${project.clientName}. This client cannot be changed.`}
                className="mt-1.5 flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--fg-default)/0.035)] px-3 text-[14px] text-[rgb(var(--fg-muted))]"
              >
                <Lock size={14} strokeWidth={2.1} aria-hidden className="shrink-0" />
                <span className="min-w-0 truncate">{project.clientName}</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor={`edit-project-deadline-${project.id}`} optional>
                  Deadline
                </FieldLabel>
                <input
                  id={`edit-project-deadline-${project.id}`}
                  type="date"
                  value={deadline}
                  onChange={(event) => {
                    setDeadline(event.target.value);
                  }}
                  className="mt-1.5 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[14px]"
                />
              </div>

              <div>
                <FieldLabel htmlFor={`edit-project-stage-${project.id}`}>
                  Project workflow
                </FieldLabel>
                <select
                  id={`edit-project-stage-${project.id}`}
                  value={workflowStage}
                  onChange={(event) => {
                    setWorkflowStage(event.target.value as ProjectWorkflowStage);
                  }}
                  className="mt-1.5 min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:text-[14px]"
                >
                  {PROJECT_WORKFLOW_STAGE_OPTIONS.map((stage) => (
                    <option key={stage.value} value={stage.value}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
              This is the overall project workflow. Individual song stages stay unchanged.
            </p>

            <div className="flex flex-col-reverse gap-2 border-t border-[rgb(var(--border-subtle))] pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !hasChanges || cleanTitle.length === 0}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-background))] disabled:opacity-45"
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FieldLabel({
  htmlFor,
  children,
  optional = false,
}: {
  htmlFor: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
      {children}
      {optional ? (
        <span className="ml-1 font-normal text-[rgb(var(--fg-muted))]">Optional</span>
      ) : null}
    </label>
  );
}
