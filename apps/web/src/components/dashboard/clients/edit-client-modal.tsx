"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
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
import { updateClientAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

// Edit Client modal (PR #130). Mirrors NewClientModal's layout exactly
// so the producer's mental model stays the same — same 4 fields
// (Name, Email, Phone, Notes), same validation, same Radix Dialog
// scrim/backdrop. The only differences:
//   - Fields pre-fill from the passed `client` snapshot.
//   - Submit hits updateClientAction (the existing tRPC
//     clientContacts.update procedure, extended to accept phone +
//     notes in PR #130).
//   - Empty Phone/Notes inputs clear the column (send "" — the server
//     action normalises to null before write).
//   - Primary CTA reads "Save changes" instead of "Add client".
//
// We don't ship the amber "Invitation will be emailed" hint here —
// editing an existing client never triggers a new invite, so the copy
// would be misleading.

export interface EditClientModalProps {
  open: boolean;
  onClose: () => void;
  client: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    notes: string | null;
  };
  /** Fired after a successful update — parent can refresh. */
  onSaved?: () => void;
}

export function EditClientModal({
  open,
  onClose,
  client,
  onSaved,
}: EditClientModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email);
  const [phone, setPhone] = useState(client.phone ?? "");
  const [notes, setNotes] = useState(client.notes ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const nameState: ValidationState = nameTouched
    ? validateDisplayName(name)
    : { kind: "idle" };
  const emailState: ValidationState = emailTouched
    ? validateEmail(email)
    : { kind: "idle" };

  // Re-seed every time the modal opens so an edit-cancel-reopen flow
  // always starts from the canonical server state (not stale form
  // state from the previous open). client identity changes count too
  // — though the Client Space hero only ever mounts one EditModal,
  // a parent that swaps clients would expect the fields to follow.
  useEffect(() => {
    if (!open) return;
    setName(client.name);
    setEmail(client.email);
    setPhone(client.phone ?? "");
    setNotes(client.notes ?? "");
    setNameTouched(false);
    setEmailTouched(false);
  }, [open, client.id, client.name, client.email, client.phone, client.notes]);

  const submitDisabled =
    pending || name.trim().length === 0 || email.trim().length === 0;

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNameTouched(true);
    setEmailTouched(true);
    const finalName = validateDisplayName(name);
    const finalEmail = validateEmail(email);
    if (finalName.kind !== "valid" || finalEmail.kind !== "valid") {
      return;
    }
    startTransition(async () => {
      // Only send fields that actually changed. Avoids hitting the
      // server with no-op patches AND avoids touching emailHash when
      // the producer only edited their phone.
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const trimmedPhone = phone.trim();
      const trimmedNotes = notes.trim();
      const payload: {
        id: string;
        name?: string;
        email?: string;
        phone?: string | null;
        notes?: string | null;
      } = { id: client.id };
      if (trimmedName !== client.name) payload.name = trimmedName;
      if (trimmedEmail.toLowerCase() !== client.email.toLowerCase()) {
        payload.email = trimmedEmail;
      }
      // Phone/notes: empty string clears, non-empty sets, unchanged skips.
      const currentPhone = client.phone ?? "";
      const currentNotes = client.notes ?? "";
      if (trimmedPhone !== currentPhone) {
        payload.phone = trimmedPhone.length > 0 ? trimmedPhone : null;
      }
      if (trimmedNotes !== currentNotes) {
        payload.notes = trimmedNotes.length > 0 ? trimmedNotes : null;
      }
      // Nothing to do — close without a server round-trip.
      if (Object.keys(payload).length === 1) {
        onClose();
        return;
      }
      const res = await updateClientAction(payload);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Client updated", "success");
      onSaved?.();
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
          aria-describedby="edit-client-modal-body"
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-w-[440px] rounded-[18px] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                Edit client
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="edit-client-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                Update name, email, phone, or notes.
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
            <FieldLabel htmlFor="edit-client-name" required>
              Name
            </FieldLabel>
            <div>
              <input
                id="edit-client-name"
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <FieldLabel htmlFor="edit-client-email" required>
                  Email
                </FieldLabel>
                <div>
                  <input
                    id="edit-client-email"
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
                <FieldLabel htmlFor="edit-client-phone">Phone</FieldLabel>
                <input
                  id="edit-client-phone"
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

            <FieldLabel htmlFor="edit-client-notes">
              Notes <span className="text-[rgb(var(--fg-muted))]">(optional)</span>
            </FieldLabel>
            <textarea
              id="edit-client-notes"
              value={notes}
              rows={3}
              maxLength={2000}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              placeholder="Genre, references, anything to remember..."
              className="w-full resize-none rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)]"
              style={{ borderColor: "rgb(var(--border-subtle))" }}
            />

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
                {pending ? "Saving…" : "Save changes"}
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
