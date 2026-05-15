"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Mail, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type SyntheticEvent,
  useEffect,
  useState,
  useTransition,
} from "react";

import { useToast } from "~/components/ui/toast";
import {
  ValidationHint,
  validateDisplayName,
  validateEmail,
  type ValidationState,
} from "~/components/ui/validation";
import { createClientAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

// New Client modal (Clients & Projects v3 redesign, Phase 1 G6).
// Replaces the routing-based "+ New client" CTA that previously sent
// the producer to the new-project form. DESIGN.md §6.1 / BUILD-NOTES
// §7.1 spec this as a floating modal with four fields:
//   Name (required), Email (required), Phone (optional), Notes (optional)
// On submit we hit createClientAction which atomically does:
//   1. trpc.clientContacts.create  — insert (or short-circuit on dup)
//   2. trpc.clientContacts.sendInvite { via: "email" }  — fire invite
// If the email is already in the producer's CRM, the action returns
// `existed: true` without re-sending the invite. The modal then surfaces
// a friendly toast + routes to the existing client's space.
//
// Layout precedent: ../clients/invite-modal.tsx — same Radix Dialog
// fixed-center transform fix, same scrim + backdrop-blur, same close
// button placement. The CSS tokens used here are canonical Skitza:
//   --bg-background, --bg-elevated, --fg-default, --fg-muted, --fg-danger,
//   --brand-primary, --border-subtle.

export interface NewClientModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful create + invite — parent can refresh. */
  onCreated?: () => void;
}

export function NewClientModal({
  open,
  onClose,
  onCreated,
}: NewClientModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  // "Touched" suppresses red Required hints until the user moves off
  // a field — same pattern as new-project-form.tsx.
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const nameState: ValidationState = nameTouched
    ? validateDisplayName(name)
    : { kind: "idle" };
  const emailState: ValidationState = emailTouched
    ? validateEmail(email)
    : { kind: "idle" };

  // Reset form state every time the modal opens. Carrying values across
  // open/close is confusing — the producer expects a blank slate.
  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setPhone("");
    setNotes("");
    setNameTouched(false);
    setEmailTouched(false);
  }, [open]);

  const submitDisabled =
    pending ||
    name.trim().length === 0 ||
    email.trim().length === 0;

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Flip the touched flags so any final validation errors render.
    setNameTouched(true);
    setEmailTouched(true);
    const finalNameState = validateDisplayName(name);
    const finalEmailState = validateEmail(email);
    if (
      finalNameState.kind !== "valid" ||
      finalEmailState.kind !== "valid"
    ) {
      // Inline hints already explain what's wrong; no duplicate toast.
      return;
    }
    startTransition(async () => {
      // exactOptionalPropertyTypes: pass keys only when they have a
      // value, never as `undefined`.
      const trimmedPhone = phone.trim();
      const trimmedNotes = notes.trim();
      const payload: {
        name: string;
        email: string;
        phone?: string;
        notes?: string;
      } = {
        name: name.trim(),
        email: email.trim(),
      };
      if (trimmedPhone) payload.phone = trimmedPhone;
      if (trimmedNotes) payload.notes = trimmedNotes;
      const res = await createClientAction(payload);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      if (res.data.existed) {
        toast("That client already exists — opening their space.", "info");
        router.push(`/dashboard/clients-projects/clients/${res.data.id}`);
        onClose();
        return;
      }
      if (res.data.inviteEmailFailed) {
        // Client row was inserted but the invite email didn't send
        // (Resend rejection, sandbox limit, etc). Tell the producer
        // it's saved and they can retry the invite from the client's
        // space. The LinkPill there shows "Invite to app" because the
        // procedure never stamped invited_at.
        toast(
          "Client added — invite email couldn't be sent. Try again from their page.",
          "info",
        );
      } else {
        toast("Client added — invite sent", "success");
      }
      onCreated?.();
      // Server Action already called revalidatePath, but a manual
      // router.refresh keeps the list in sync if the parent isn't a
      // server-component boundary.
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
          aria-describedby="new-client-modal-body"
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[440px] rounded-[18px] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                New client
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="new-client-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                Just the basics — you can edit later.
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

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <FieldLabel htmlFor="new-client-name" required>
              Name
            </FieldLabel>
            <div>
              <input
                id="new-client-name"
                type="text"
                required
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                onBlur={() => {
                  setNameTouched(true);
                }}
                aria-invalid={
                  nameState.kind === "invalid" || nameState.kind === "required"
                }
                placeholder="Artist or band name"
                className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              />
              <ValidationHint state={nameState} />
            </div>

            {/* Email + Phone in a 2-column row on the desktop modal.
                Collapses to single-column on very narrow viewports
                (the modal is desktop-first but defensive against
                480px-wide phones in case the producer opens it on
                their phone). */}
            {/* Email + Phone share a row. The form's parent gap-3 +
                FieldLabel's -mb-2.5 offsets keep label/input spacing
                visually identical to the stacked Name field above.
                Collapses to single-column under sm: in case the
                producer opens the modal on a phone. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <FieldLabel htmlFor="new-client-email" required>
                  Email
                </FieldLabel>
                <div>
                  <input
                    id="new-client-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                    }}
                    onBlur={() => {
                      setEmailTouched(true);
                    }}
                    aria-invalid={
                      emailState.kind === "invalid" ||
                      emailState.kind === "required"
                    }
                    placeholder="they@example.com"
                    className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                    style={{ borderColor: "rgb(var(--border-subtle))" }}
                  />
                  <ValidationHint state={emailState} />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <FieldLabel htmlFor="new-client-phone">Phone</FieldLabel>
                <input
                  id="new-client-phone"
                  type="tel"
                  value={phone}
                  maxLength={40}
                  onChange={(e) => {
                    setPhone(e.target.value);
                  }}
                  placeholder="+972 50 ..."
                  className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                />
              </div>
            </div>

            <FieldLabel htmlFor="new-client-notes">
              Notes <span className="text-[rgb(var(--fg-muted))]">(optional)</span>
            </FieldLabel>
            <textarea
              id="new-client-notes"
              value={notes}
              rows={2}
              maxLength={2000}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              placeholder="Genre, references, anything to remember..."
              className="w-full resize-none rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
              style={{ borderColor: "rgb(var(--border-subtle))" }}
            />

            <div
              className="flex items-start gap-2 rounded-[10px] border px-3 py-2 text-[12px]"
              style={{
                borderColor: "rgb(var(--brand-primary)/0.40)",
                background: "rgb(var(--brand-primary)/0.10)",
              }}
            >
              <Mail
                size={13}
                strokeWidth={2.2}
                className="mt-0.5 shrink-0 text-[rgb(var(--brand-primary))]"
                aria-hidden
              />
              <p className="leading-snug text-[rgb(var(--fg-muted))]">
                <span className="font-semibold text-[rgb(var(--fg-default))]">
                  Invitation will be emailed.
                </span>{" "}
                They&rsquo;ll get the artist app to comment, sign contracts, and
                pay.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="sk-press inline-flex items-center justify-center rounded-[10px] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                className="sk-press inline-flex items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none"
                style={{ background: "rgb(var(--brand-primary))" }}
              >
                {pending ? "Adding…" : "Add client"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="-mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
    >
      {children}
      {required ? (
        <span aria-hidden className="ml-0.5 text-[rgb(var(--fg-danger))]">
          *
        </span>
      ) : null}
    </label>
  );
}
