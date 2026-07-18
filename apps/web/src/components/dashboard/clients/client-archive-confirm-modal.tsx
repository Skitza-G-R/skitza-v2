"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Archive, ArchiveRestore, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  archiveClientAction,
  restoreClientAction,
} from "~/app/(producer)/dashboard/clients-projects/clients-actions";
import { useToast } from "~/components/ui/toast";

export interface ClientArchiveConfirmModalProps {
  open: boolean;
  onClose: () => void;
  client: {
    id: string;
    name: string;
    archived: boolean;
  };
  blockedReason?: string | null;
  onChanged?: (archived: boolean) => void;
}

export function ClientArchiveConfirmModal({
  open,
  onClose,
  client,
  blockedReason,
  onChanged,
}: ClientArchiveConfirmModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const isRestore = client.archived;
  const archiveIsBlocked = !isRestore && Boolean(blockedReason);

  const handleChange = () => {
    if (archiveIsBlocked) return;

    startTransition(async () => {
      const action = client.archived ? restoreClientAction : archiveClientAction;
      const result = await action({ id: client.id });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      const nextArchived = !client.archived;
      toast(`${client.name} ${nextArchived ? "archived" : "restored"}`, "success");
      onChanged?.(nextArchived);
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
          aria-describedby="archive-client-modal-body"
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]"
            >
              {isRestore ? (
                <ArchiveRestore size={20} strokeWidth={2.1} />
              ) : (
                <Archive size={20} strokeWidth={2.1} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display break-words text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                {isRestore ? `Restore ${client.name}?` : `Archive ${client.name}?`}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="archive-client-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                {isRestore
                  ? "This returns the client to your Active Clients list."
                  : "This only changes where the client appears in your Clients list."}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                className="sk-press -mt-2 -mr-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>

          {!isRestore ? (
            <div className="mt-4 space-y-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 text-[12.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
              <p>
                Archive preserves artist access, projects, songs, public links, purchases, offers,
                agreements, payments, proofs, sessions, versions, and comments. It does not edit or
                remove that history.
              </p>
              <p>
                A client with an Active or Waiting for payment project cannot be archived until that
                project leaves those states.
              </p>
            </div>
          ) : null}

          {archiveIsBlocked ? (
            <p
              role="alert"
              className="mt-3 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2.5 text-[12.5px] font-semibold text-[rgb(var(--fg-danger))]"
            >
              {blockedReason}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sk-press inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleChange}
              disabled={pending || archiveIsBlocked}
              className="sk-press inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-background))] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isRestore ? (
                <ArchiveRestore size={15} aria-hidden />
              ) : (
                <Archive size={15} aria-hidden />
              )}
              {pending
                ? isRestore
                  ? "Restoring…"
                  : "Archiving…"
                : isRestore
                  ? "Restore client"
                  : "Archive client"}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
