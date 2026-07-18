"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Archive, Trash2, X } from "lucide-react";

export type ProductRemovalAction = "archive" | "delete";

interface ProductRemovalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  action: ProductRemovalAction;
  onConfirm: () => void;
  pending?: boolean;
}

export function ProductRemovalModal({
  open,
  onOpenChange,
  productName,
  action,
  onConfirm,
  pending = false,
}: ProductRemovalModalProps) {
  const isArchive = action === "archive";
  const Icon = isArchive ? Archive : Trash2;
  const verb = isArchive ? "Archive" : "Delete";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          aria-describedby="product-removal-body"
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] bg-[rgb(var(--bg-background))] p-6 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.12)]"
            >
              <Icon size={20} strokeWidth={2.2} className="text-[rgb(var(--fg-danger))]" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                {`${verb} "${productName}"?`}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="product-removal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                {isArchive
                  ? "This removes the product from your Store while keeping its purchase history. You can undo for a few seconds."
                  : "This product has no purchase history. Deleting it is permanent and cannot be undone."}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] sm:h-8 sm:w-8"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="sk-press inline-flex h-11 items-center rounded-[var(--radius-lg)] px-3 text-[12.5px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.05)] hover:text-[rgb(var(--fg-default))]"
              >
                Cancel
              </button>
            </DialogPrimitive.Close>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="sk-press inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-3 text-[12.5px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--fg-danger)/0.5)] disabled:opacity-50"
            >
              <Icon size={12} strokeWidth={2.2} />
              {verb} product
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
