"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link2, Mail, MessageCircle, X } from "lucide-react";
import { type RefObject, useState } from "react";

import { useToast } from "~/components/ui/toast";
import { buildPrivateOfferInviteUrl } from "~/lib/clients/invite-url";

// Share surface for one private offer (SK-294). The link is the same
// producer-join route the notification email uses: a new client signs up
// under this producer and lands on the offer; an existing client signs in
// (or passes straight through) into their account. WhatsApp reuses the
// invite-modal pattern — `wa.me/?text=` opens the producer's own chat
// picker and records nothing server-side.

export type PrivateOfferShareDetails = Readonly<{
  offerId: string;
  offerName: string;
  recipientName: string;
  recipientEmail: string;
  emailDelivered?: boolean | null;
}>;

export function privateOfferShareMessage(shareUrl: string): string {
  return `I sent you a private offer on Skitza — open it here: ${shareUrl}`;
}

export function privateOfferWhatsAppUrl(shareUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(privateOfferShareMessage(shareUrl))}`;
}

export interface PrivateOfferShareModalProps {
  open: boolean;
  onClose: () => void;
  /** Null keeps the dialog unmounted between offers. */
  offer: PrivateOfferShareDetails | null;
  producerSlug: string;
  /** "sent" celebrates a just-sent offer; "reshare" is the list-row action. */
  occasion: "sent" | "reshare";
  /** Stable trigger that receives focus after a controlled launch closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function PrivateOfferShareModal({
  open,
  onClose,
  offer,
  producerSlug,
  occasion,
  returnFocusRef,
}: PrivateOfferShareModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  if (!offer) return null;

  const shareUrl = buildPrivateOfferInviteUrl(producerSlug, offer.offerId);
  const emailFailed = occasion === "sent" && offer.emailDelivered === false;

  const handleWhatsApp = () => {
    window.open(privateOfferWhatsAppUrl(shareUrl), "_blank", "noopener,noreferrer");
  };

  const handleCopyLink = () => {
    void navigator.clipboard.writeText(shareUrl).then(
      () => {
        setCopied(true);
        toast("Offer link copied", "success");
      },
      () => {
        toast("Couldn't copy link — try again", "error");
      },
    );
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          aria-describedby="private-offer-share-body"
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-[rgb(var(--bg-background))] p-6 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                {occasion === "sent"
                  ? `Offer sent to ${offer.recipientName}`
                  : "Share private offer"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="private-offer-share-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                {occasion === "sent"
                  ? "You can also send the offer link yourself. New clients create their account on the way in; existing clients land straight on the offer."
                  : `Send ${offer.recipientName} the link to “${offer.offerName}”. New clients create their account on the way in; existing clients land straight on the offer.`}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-[8px] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </DialogPrimitive.Close>
          </div>

          {emailFailed ? (
            <p
              role="status"
              className="mt-4 rounded-[var(--radius-sm)] border border-[rgb(var(--fg-warning)/0.25)] bg-[rgb(var(--fg-warning)/0.08)] px-3 py-2 text-[12.5px] font-medium text-[rgb(var(--fg-warning-text))]"
            >
              The email notification couldn’t be delivered — send the link yourself.
            </p>
          ) : null}

          <div
            className="mt-4 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px]"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              background: "rgb(var(--bg-elevated))",
            }}
          >
            <Mail
              size={14}
              strokeWidth={2.2}
              className="shrink-0 text-[rgb(var(--fg-muted))]"
              aria-hidden
            />
            <span className="min-w-0 truncate text-[rgb(var(--fg-default))]">
              {offer.recipientEmail}
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            The offer opens only for this verified email.
          </p>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleWhatsApp}
              className="sk-press inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-[13px] font-semibold text-[rgb(var(--fg-on-brand))] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)]"
              style={{ background: "rgb(var(--brand-primary))" }}
            >
              <MessageCircle size={14} strokeWidth={2.2} />
              Share on WhatsApp
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="sk-press inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border px-3 py-2.5 text-[13px] font-semibold"
              style={{
                borderColor: "rgb(var(--border-subtle))",
                color: "rgb(var(--fg-default))",
                background: "rgb(var(--bg-elevated))",
              }}
            >
              <Link2 size={14} strokeWidth={2.2} />
              {copied ? "Link copied" : "Copy link"}
            </button>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="sk-press inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] px-3 py-2.5 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
              >
                Done
              </button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
