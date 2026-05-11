"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";

interface DeleteConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  onConfirm: () => void;
  pending?: boolean;
}

export function DeleteConfirmModal({
  open,
  onOpenChange,
  productName,
  onConfirm,
  pending = false,
}: DeleteConfirmModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          aria-describedby="delete-confirm-body"
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[420px] rounded-[18px] bg-[rgb(var(--bg-elevated))] p-6 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]"
              style={{ background: "rgb(var(--fg-danger) / 0.12)" }}
            >
              <Trash2 size={20} strokeWidth={2.2} className="text-[rgb(var(--fg-danger))]" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                {`Delete "${productName}"?`}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="delete-confirm-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                Removed from your storefront. You can undo for a few seconds. Existing bookings stay intact.
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
          <div className="mt-5 flex items-center justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="sk-press inline-flex items-center rounded-[8px] px-3 py-2 text-[12.5px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
              >
                Cancel
              </button>
            </DialogPrimitive.Close>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="sk-press inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.5)] disabled:opacity-50"
              style={{ background: "rgb(var(--fg-danger))" }}
            >
              <Trash2 size={12} strokeWidth={2.2} />
              Delete product
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
