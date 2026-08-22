"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link2, Mail, MessageCircle, X } from "lucide-react";
import { type RefObject, useRef, useState, useTransition } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { sendClientInviteAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";
import { buildClientInviteUrl } from "~/lib/clients/invite-url";

import type { LinkPillState } from "./client-invitation-state";

// Invite-to-App modal (Clients & Projects v3 redesign, Phase 1 Task 11).
// Three deliberate actions:
//   1. "Send invite email" — fires sendClientInviteAction with via='email'.
//      Disabled + dimmed when client.email is null (no address on file).
//   2. "Share on WhatsApp" — opens WhatsApp with the same producer join URL.
//      It never records invitation evidence or calls onSent.
//   3. "Copy invite link" — writes the verified artist signup URL to the
//      clipboard and records deletion-safety history. It never creates
//      provider-accepted invitation evidence or flips the LinkPill.
//
// Layout precedent: apps/web/src/app/(producer)/dashboard/store/
// delete-confirm-modal.tsx — fixed-center transform on Dialog.Content
// matches the storefront fix (memory: session_recap.md → "top-left then
// snap to center" bug).

export interface InviteToAppModalProps {
  open: boolean;
  onClose: () => void;
  client: {
    id: string;
    name: string;
    email: string | null;
    /** CSS background string (gradient) for the avatar tile. */
    gradient: string;
  };
  /** Producer slug — used to build the public invite URL. */
  producerSlug: string;
  /** Current durable invitation state when this modal opens. */
  invitationState?: LinkPillState;
  /** Optional callback fired only after provider acceptance. */
  onSent?: () => void;
  /** Stable trigger that receives focus after a controlled launch closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function InviteToAppModal({
  open,
  onClose,
  client,
  producerSlug,
  invitationState = "none",
  onSent,
  returnFocusRef,
}: InviteToAppModalProps) {
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [sendState, setSendState] = useState<
    "idle" | "sending" | "failed" | "new_operation_required"
  >(() =>
    invitationState === "sending" ? "sending" : invitationState === "failed" ? "failed" : "idle",
  );
  const emailAttemptRef = useRef<{
    clientId: string;
    operationKey: string;
    rotateOnNextClick: boolean;
  } | null>(null);
  const inviteUrl = buildClientInviteUrl(producerSlug);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Join me on Skitza: ${inviteUrl}`)}`;
  const initials = producerInitials(client.name);
  const hasEmail = client.email !== null && client.email.length > 0;
  const idleEmailLabel =
    invitationState === "pending" ? "Resend invite email" : "Send invite email";

  function emailOperationKeyForClick(): string {
    const current = emailAttemptRef.current;
    if (!current || current.clientId !== client.id || current.rotateOnNextClick) {
      const operationKey = `client-invite:${client.id}:${crypto.randomUUID()}`;
      emailAttemptRef.current = {
        clientId: client.id,
        operationKey,
        rotateOnNextClick: false,
      };
      return operationKey;
    }
    return current.operationKey;
  }

  const handleSendEmail = () => {
    if (!online) {
      toast("Reconnect to send this invite.", "error");
      return;
    }
    const operationKey = emailOperationKeyForClick();
    setSendState("idle");
    startTransition(async () => {
      try {
        const res = await sendClientInviteAction({
          id: client.id,
          via: "email",
          operationKey,
        });
        if (!res.ok) {
          if (res.code === "new_operation_required") {
            if (emailAttemptRef.current?.operationKey === operationKey) {
              emailAttemptRef.current.rotateOnNextClick = true;
            }
            setSendState("new_operation_required");
          } else {
            setSendState("failed");
          }
          toast(res.error, "error");
          return;
        }
        if (
          res.data.via !== "email" ||
          res.data.deliveryState !== "provider_accepted" ||
          !res.data.providerAcceptedAtIso
        ) {
          setSendState("sending");
          toast("The invitation email is still sending. Try again in a moment.", "info");
          return;
        }
        emailAttemptRef.current = null;
        setSendState("idle");
        toast("Invitation email sent", "success");
        onSent?.();
        onClose();
      } catch {
        setSendState("failed");
        toast("Could not send this invite. Try again.", "error");
      }
    });
  };

  const handleCopyLink = () => {
    if (!online) {
      toast("Reconnect to copy and register this invite link.", "error");
      return;
    }
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {
        toast("Couldn't copy link — try again", "error");
        return;
      }
      try {
        const res = await sendClientInviteAction({
          id: client.id,
          via: "link",
          operationKey: `client-invite-link:${client.id}:${crypto.randomUUID()}`,
        });
        if (!res.ok) {
          toast("Link copied, but Skitza couldn't save this action. Try again.", "error");
          return;
        }
        toast("Link copied", "success");
        onClose();
      } catch {
        toast("Link copied, but Skitza couldn't save this action. Try again.", "error");
      }
    });
  };

  const handleWhatsApp = () => {
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
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
          aria-describedby="invite-modal-body"
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-[rgb(var(--bg-background))] p-6 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-bold text-white"
              style={{ background: client.gradient }}
            >
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                Invite to app
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="invite-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                Give your client access to the artist app.
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

          <div
            className="mt-5 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px]"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              background: "rgb(var(--bg-elevated))",
              opacity: hasEmail ? 1 : 0.5,
            }}
            aria-label="Email on file"
          >
            <Mail
              size={14}
              strokeWidth={2.2}
              className="shrink-0 text-[rgb(var(--fg-muted))]"
              aria-hidden
            />
            <span className="truncate text-[rgb(var(--fg-default))]" data-testid="invite-email-row">
              {hasEmail ? client.email : "No email on file"}
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSendEmail}
              disabled={!hasEmail || pending}
              className="sk-press inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none"
              style={{ background: "rgb(var(--brand-primary))" }}
            >
              <Mail size={14} strokeWidth={2.2} />
              {pending
                ? "Sending…"
                : sendState === "new_operation_required"
                  ? "Try a new send"
                  : sendState === "sending"
                    ? "Check send status"
                    : sendState === "failed"
                      ? "Retry invite email"
                      : idleEmailLabel}
            </button>
            <p aria-live="polite" className="min-h-4 text-[11.5px] text-[rgb(var(--fg-muted))]">
              {sendState === "sending"
                ? "The invitation is still sending. Check again in a moment."
                : sendState === "new_operation_required"
                  ? "This send expired. Choose Try a new send to start again."
                  : sendState === "failed"
                    ? "The last invitation email failed. You can try again."
                    : ""}
            </p>
            <button
              type="button"
              onClick={handleWhatsApp}
              className="sk-press inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border px-3 py-2.5 text-[13px] font-semibold"
              style={{
                borderColor: "rgb(var(--border-subtle))",
                color: "rgb(var(--fg-default))",
                background: "rgb(var(--bg-elevated))",
              }}
            >
              <MessageCircle size={14} strokeWidth={2.2} />
              Share on WhatsApp
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={pending}
              className="sk-press inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border px-3 py-2.5 text-[13px] font-semibold disabled:opacity-50"
              style={{
                borderColor: "rgb(var(--border-subtle))",
                color: "rgb(var(--fg-default))",
                background: "rgb(var(--bg-elevated))",
              }}
            >
              <Link2 size={14} strokeWidth={2.2} />
              Copy invite link
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
