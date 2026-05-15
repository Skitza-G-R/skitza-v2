"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link2, Mail, X } from "lucide-react";
import { useTransition } from "react";

import { useToast } from "~/components/ui/toast";
import { producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { sendClientInviteAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

// Invite-to-App modal (Clients & Projects v3 redesign, Phase 1 Task 11).
// Two CTAs:
//   1. "Send invite email" — fires sendClientInviteAction with via='email'.
//      Disabled + dimmed when client.email is null (no address on file).
//   2. "Copy invite link"  — writes skitza.app/invite/<slug>-<id> to
//      clipboard via navigator.clipboard.writeText, then fires the same
//      action with via='link' so the server stamps invited_at and the
//      LinkPill flips to "Invited" either way.
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
  /** Optional callback fired after a successful send. */
  onSent?: () => void;
}

export function InviteToAppModal({
  open,
  onClose,
  client,
  producerSlug,
  onSent,
}: InviteToAppModalProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const inviteUrl = `https://skitza.app/invite/${producerSlug}-${client.id}`;
  const initials = producerInitials(client.name);
  const hasEmail = client.email !== null && client.email.length > 0;

  const handleSendEmail = () => {
    startTransition(async () => {
      const res = await sendClientInviteAction({
        id: client.id,
        via: "email",
      });
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Invite sent", "success");
      onSent?.();
      onClose();
    });
  };

  const handleCopyLink = () => {
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {
        toast("Couldn't copy link — try again", "error");
        return;
      }
      const res = await sendClientInviteAction({
        id: client.id,
        via: "link",
      });
      if (!res.ok) {
        // Link is copied either way; surface the server miss so the
        // producer knows the LinkPill won't flip.
        toast(res.error, "error");
        return;
      }
      toast("Link copied", "success");
      onSent?.();
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
          aria-describedby="invite-modal-body"
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[440px] rounded-[18px] bg-[rgb(var(--bg-background))] p-6 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
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
                {`Invite ${client.name}`}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="invite-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                Send them a Skitza invite. They&apos;ll see your projects,
                hear their mixes, and book new sessions.
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
            <span
              className="truncate text-[rgb(var(--fg-default))]"
              data-testid="invite-email-row"
            >
              {hasEmail ? client.email : "No email on file"}
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSendEmail}
              disabled={!hasEmail || pending}
              className="sk-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none"
              style={{ background: "rgb(var(--brand-primary))" }}
            >
              <Mail size={14} strokeWidth={2.2} />
              Send invite email
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={pending}
              className="sk-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border px-3 py-2.5 text-[13px] font-semibold disabled:opacity-50"
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
