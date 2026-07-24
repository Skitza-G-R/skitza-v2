"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useTransition } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { removeClientAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

// Permanent-delete confirmation. The shared Chat 4 domain boundary
// rejects anything except an unlinked, uninvited, unarchived client
// with no history; this dialog explains that fail-closed behavior.
// After success we route back to /dashboard/clients-projects so the
// producer isn't staring at a now-broken Client Space.

export interface RemoveClientConfirmModalProps {
  open: boolean;
  onClose: () => void;
  client: {
    id: string;
    name: string;
  };
  /** Fired after a successful remove — parent can chain side-effects. */
  onRemoved?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const CLIENTS_PATH = "/dashboard/clients-projects";

export function RemoveClientConfirmModal({
  open,
  onClose,
  client,
  onRemoved,
  returnFocusRef,
}: RemoveClientConfirmModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();

  const handleRemove = () => {
    if (!online) {
      toast("Reconnect to remove this client.", "error");
      return;
    }
    startTransition(async () => {
      try {
        const res = await removeClientAction({ id: client.id });
        if (!res.ok) {
          toast(res.error, "error");
          return;
        }
        toast(`${client.name} permanently deleted`, "success");
        onRemoved?.();
        router.push(CLIENTS_PATH);
        router.refresh();
        onClose();
      } catch {
        toast("Could not remove this client. Try again.", "error");
      }
    });
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
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
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
              style={{
                background: "rgb(var(--fg-danger) / 0.12)",
                color: "rgb(var(--fg-danger))",
              }}
            >
              <AlertTriangle size={20} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                Permanently delete {client.name}?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                Skitza never deletes history. This truly empty draft has none, so only its contact
                entry will be deleted. This can&rsquo;t be undone.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>

          {/* <md: HIG action-sheet order — the red destructive action
              full-width on top, Cancel below it. md+: the original
              right-aligned Cancel/Remove pair. */}
          <div className="mt-5 flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sk-press inline-flex min-h-[48px] items-center justify-center rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50 md:min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending}
              className="sk-press inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.5)] disabled:opacity-50 disabled:shadow-none md:min-h-[44px]"
              style={{ background: "rgb(var(--fg-danger))" }}
            >
              {pending ? "Deleting…" : "Permanently delete"}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
