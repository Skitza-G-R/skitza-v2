"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Archive, ArchiveRestore, ChevronDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useEffect, useState, useTransition } from "react";

import {
  archiveClientAction,
  restoreClientAction,
} from "~/app/(producer)/dashboard/clients-projects/clients-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
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
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ClientArchiveConfirmModal({
  open,
  onClose,
  client,
  blockedReason,
  onChanged,
  returnFocusRef,
}: ClientArchiveConfirmModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [runtimeBlockedReason, setRuntimeBlockedReason] = useState<string | null>(null);
  const isRestore = client.archived;
  const effectiveBlockedReason = blockedReason ?? runtimeBlockedReason;
  const archiveIsBlocked = !isRestore && Boolean(effectiveBlockedReason);

  useEffect(() => {
    if (open) setRuntimeBlockedReason(null);
  }, [open, client.id]);

  const handleChange = () => {
    if (archiveIsBlocked) return;
    if (!online) {
      toast(`Reconnect to ${isRestore ? "restore" : "archive"} this client.`, "error");
      return;
    }

    startTransition(async () => {
      try {
        const action = client.archived ? restoreClientAction : archiveClientAction;
        const result = await action({ id: client.id });
        if (!result.ok) {
          if (!isRestore && "code" in result && result.code === "BLOCKING_PROJECT") {
            setRuntimeBlockedReason(result.error);
            router.refresh();
            return;
          }
          toast(result.error, "error");
          return;
        }

        const nextArchived = !client.archived;
        toast(`${client.name} ${nextArchived ? "archived" : "restored"}`, "success");
        onChanged?.(nextArchived);
        router.refresh();
        onClose();
      } catch {
        toast(`Could not ${isRestore ? "restore" : "archive"} this client. Try again.`, "error");
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
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                {isRestore
                  ? `Restore ${client.name}?`
                  : archiveIsBlocked
                    ? `Can’t archive ${client.name}`
                    : `Archive ${client.name}?`}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                {isRestore
                  ? `Returns ${client.name} to Active clients.`
                  : archiveIsBlocked
                    ? effectiveBlockedReason
                    : `Moves ${client.name} to Archived. Artist access and complete history stay unchanged.`}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>

          {!isRestore && !archiveIsBlocked ? (
            <details className="group mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[12.5px] text-[rgb(var(--fg-muted))]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                What stays unchanged?
                <ChevronDown
                  size={15}
                  aria-hidden
                  className="text-[rgb(var(--fg-muted))] transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="space-y-2 border-t border-[rgb(var(--border-subtle))] px-3 py-2.5 leading-relaxed">
                <p>
                  Artist access, projects, songs, public links, purchases, offers, agreements,
                  payments, proofs, sessions, versions, and comments stay exactly as they are.
                </p>
                <p>Clients with an Active or Waiting for payment project cannot be archived yet.</p>
              </div>
            </details>
          ) : null}

          {archiveIsBlocked ? (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="sk-press inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-background))]"
              >
                Got it
              </button>
            </div>
          ) : null}

          {!archiveIsBlocked ? (
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="sk-press inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
              >
                {isRestore ? "Cancel" : "Keep active"}
              </button>
              <button
                type="button"
                onClick={handleChange}
                disabled={pending}
                className="sk-press inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-background))] disabled:opacity-45"
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
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
