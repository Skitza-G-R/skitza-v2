"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useTransition } from "react";

import { deleteEmptyDraftProjectAction } from "~/app/(producer)/dashboard/clients-projects/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

import type { ProjectActionProject } from "./project-action-types";

export interface DeleteEmptyProjectDialogProps {
  open: boolean;
  onClose: () => void;
  project: ProjectActionProject;
  onDeleted?: ((projectId: string) => void) | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}

export function DeleteEmptyProjectDialog({
  open,
  onClose,
  project,
  onDeleted,
  returnFocusRef,
}: DeleteEmptyProjectDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!online) {
      toast("Reconnect to delete this project.", "error");
      return;
    }
    startTransition(async () => {
      try {
        const result = await deleteEmptyDraftProjectAction({ id: project.id });
        if (!result.ok) {
          toast(result.error, "error");
          return;
        }

        toast(`${project.title} permanently deleted`, "success");
        onDeleted?.(project.id);
        router.refresh();
        onClose();
      } catch {
        toast("Could not delete this project. Try again.", "error");
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
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.1)] text-[rgb(var(--fg-danger))]"
            >
              <AlertTriangle size={20} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                Permanently delete {project.title}?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                This deletes the empty draft itself. It cannot be undone.
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

          <div className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.18)] bg-[rgb(var(--fg-danger)/0.06)] p-3.5 text-[12.5px] leading-relaxed text-[rgb(var(--fg-danger-text))]">
            <p className="font-semibold">
              Deletion is allowed only while this draft is truly empty.
            </p>
            <p className="mt-1.5">
              If it has any commercial, song, version, comment, session, or public-link history,
              Skitza will keep it and reject this deletion.
            </p>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
            >
              Keep draft
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-4 text-[13px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.5)] disabled:opacity-45 disabled:shadow-none"
            >
              {pending ? "Deleting…" : "Permanently delete"}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
