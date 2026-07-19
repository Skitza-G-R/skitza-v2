"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Archive, ArchiveRestore, Ban, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useTransition } from "react";

import {
  cancelProjectAction,
  completeProjectAction,
  reopenProjectAction,
} from "~/app/(producer)/dashboard/clients-projects/actions";
import { useToast } from "~/components/ui/toast";

import type { ProjectActionProject } from "./project-action-types";

export type ProjectLifecycleDialogMode = "complete" | "cancel" | "reopen";

export interface ProjectLifecycleDialogProps {
  open: boolean;
  onClose: () => void;
  project: ProjectActionProject;
  mode: ProjectLifecycleDialogMode;
  onChanged?: ((projectId: string) => void) | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}

const COPY: Record<
  ProjectLifecycleDialogMode,
  {
    titleVerb: string;
    description: string;
    actionLabel: string;
    pendingLabel: string;
    toastLabel: string;
    bullets: readonly string[];
  }
> = {
  complete: {
    titleVerb: "Complete",
    description: "Archives this project as Completed.",
    actionLabel: "Complete project",
    pendingLabel: "Completing…",
    toastLabel: "completed",
    bullets: [
      "Debt and purchases stay on record. Completing the work does not waive any amount owed.",
      "Music, listening, comments and history, and public links stay available.",
      "New uploads and comments stop.",
      "Any unused session allowance closes permanently, without another warning.",
    ],
  },
  cancel: {
    titleVerb: "Cancel",
    description: "Archives this project as Canceled.",
    actionLabel: "Cancel project",
    pendingLabel: "Canceling…",
    toastLabel: "canceled",
    bullets: [
      "Only future installments are canceled. Due and overdue amounts remain unless you explicitly waive them.",
      "Paid amounts, purchase history, music, listening, and public links stay on record.",
      "No refund, credit, or money movement happens automatically.",
      "Any unused session allowance closes permanently.",
      "New uploads and comments stop.",
    ],
  },
  reopen: {
    titleVerb: "Reopen",
    description: "Returns this project to active work.",
    actionLabel: "Reopen project",
    pendingLabel: "Reopening…",
    toastLabel: "reopened",
    bullets: [
      "Canceled payment schedules stay canceled.",
      "Canceled purchases and add-ons stay canceled.",
      "Closed session allowance stays closed.",
      "Comments resume when the project becomes active. New uploads and work still require an active purchase or a new accepted offer.",
    ],
  },
};

export function ProjectLifecycleDialog({
  open,
  onClose,
  project,
  mode,
  onChanged,
  returnFocusRef,
}: ProjectLifecycleDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const copy = COPY[mode];
  const destructive = mode === "cancel";

  const handleConfirm = () => {
    startTransition(async () => {
      const action =
        mode === "complete"
          ? completeProjectAction
          : mode === "cancel"
            ? cancelProjectAction
            : reopenProjectAction;
      const result = await action({ id: project.id });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      toast(`${project.title} ${copy.toastLabel}`, "success");
      onChanged?.(project.id);
      router.refresh();
      onClose();
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
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[500px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)]"
              style={{
                background: destructive
                  ? "rgb(var(--fg-danger) / 0.1)"
                  : "rgb(var(--fg-default) / 0.06)",
                color: destructive ? "rgb(var(--fg-danger))" : "rgb(var(--fg-default))",
              }}
            >
              {mode === "complete" ? (
                <Archive size={20} strokeWidth={2.1} />
              ) : mode === "cancel" ? (
                <Ban size={20} strokeWidth={2.1} />
              ) : (
                <ArchiveRestore size={20} strokeWidth={2.1} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                {copy.titleVerb} {project.title}?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                {copy.description}
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

          <div
            className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5"
            aria-label="What happens"
          >
            <p className="text-[12px] font-bold tracking-[0.08em] text-[rgb(var(--fg-default))] uppercase">
              What happens
            </p>
            <ul className="mt-2.5 space-y-2 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              {copy.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--fg-muted))]"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
            >
              Keep as is
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-white disabled:opacity-45"
              style={{
                background: destructive ? "rgb(var(--fg-danger))" : "rgb(var(--fg-default))",
              }}
            >
              {pending ? copy.pendingLabel : copy.actionLabel}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
