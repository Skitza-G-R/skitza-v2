"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useToast } from "~/components/ui/toast";
import { removeClientAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

// Remove Client confirmation modal (PR #130). Two-step destructive
// confirm — the trigger lives inside the Client Space hero menu, and
// clicking through this modal hits removeClientAction, which calls
// clientContacts.remove (hard-delete of the CRM row only — projects,
// contracts, comments linked via the email snapshot stay).
//
// The warning copy spells out exactly what stays vs what goes so the
// producer doesn't think "Remove client" nukes their work history.
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
}

const CLIENTS_PATH = "/dashboard/clients-projects";

export function RemoveClientConfirmModal({
  open,
  onClose,
  client,
  onRemoved,
}: RemoveClientConfirmModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleRemove = () => {
    startTransition(async () => {
      const res = await removeClientAction({ id: client.id });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast(`${client.name} removed`, "success");
      onRemoved?.();
      router.push(CLIENTS_PATH);
      router.refresh();
      onClose();
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
          aria-describedby="remove-client-modal-body"
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[440px] rounded-[18px] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]"
              style={{
                background: "rgb(var(--fg-danger) / 0.12)",
                color: "rgb(var(--fg-danger))",
              }}
            >
              <AlertTriangle size={20} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                Remove {client.name}?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="remove-client-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                Their CRM card disappears from your workspace. This
                can&rsquo;t be undone.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="sk-press -mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>

          <ul
            className="mt-4 space-y-1.5 rounded-[10px] border px-3 py-2.5 text-[12.5px] leading-snug"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              background: "rgb(var(--bg-elevated))",
              color: "rgb(var(--fg-muted))",
            }}
          >
            <li>
              <span className="font-semibold text-[rgb(var(--fg-default))]">
                Stays:
              </span>{" "}
              projects, contracts, comments, payments.
            </li>
            <li>
              <span className="font-semibold text-[rgb(var(--fg-default))]">
                Goes:
              </span>{" "}
              the client entry, notes, phone, tags.
            </li>
          </ul>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sk-press inline-flex items-center justify-center rounded-[10px] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending}
              className="sk-press inline-flex items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.5)] disabled:opacity-50 disabled:shadow-none"
              style={{ background: "rgb(var(--fg-danger))" }}
            >
              {pending ? "Removing…" : "Remove client"}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
