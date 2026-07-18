"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useRef,
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
// so the producer's mental model stays the same — contact details,
// private producer notes, and tags share one focused form.
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
    tags: string[];
  };
  /** Fired after a successful update — parent can refresh. */
  onSaved?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function EditClientModal({
  open,
  onClose,
  client,
  onSaved,
  returnFocusRef,
}: EditClientModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email);
  const [phone, setPhone] = useState(client.phone ?? "");
  const [notes, setNotes] = useState(client.notes ?? "");
  const [tagsText, setTagsText] = useState(client.tags.join(", "));
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [serverEmailError, setServerEmailError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(
    Boolean(client.phone || client.notes || client.tags.length > 0),
  );
  const emailRef = useRef<HTMLInputElement>(null);

  const nameState: ValidationState = nameTouched ? validateDisplayName(name) : { kind: "idle" };
  const emailState: ValidationState = emailTouched ? validateEmail(email) : { kind: "idle" };
  const nextTags = parseClientTags(tagsText);
  const tagError = validateClientTags(tagsText);

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
    setTagsText(client.tags.join(", "));
    setNameTouched(false);
    setEmailTouched(false);
    setServerEmailError(null);
    setMoreOpen(Boolean(client.phone || client.notes || client.tags.length > 0));
  }, [open, client.id, client.name, client.email, client.phone, client.notes, client.tags]);

  const hasChanges =
    name.trim() !== client.name ||
    email.trim().toLowerCase() !== client.email.toLowerCase() ||
    phone.trim() !== (client.phone ?? "") ||
    notes.trim() !== (client.notes ?? "") ||
    !sameTags(nextTags, client.tags);
  const submitDisabled =
    pending ||
    !hasChanges ||
    name.trim().length === 0 ||
    email.trim().length === 0 ||
    tagError !== null;

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNameTouched(true);
    setEmailTouched(true);
    const finalName = validateDisplayName(name);
    const finalEmail = validateEmail(email);
    if (finalName.kind !== "valid" || finalEmail.kind !== "valid" || tagError !== null) {
      if (tagError) setMoreOpen(true);
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
        tags?: string[];
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
      if (!sameTags(nextTags, client.tags)) {
        payload.tags = nextTags;
      }
      // Nothing to do — close without a server round-trip.
      if (Object.keys(payload).length === 1) {
        onClose();
        return;
      }
      const res = await updateClientAction(payload);
      if (!res.ok) {
        if (res.error.toLowerCase().includes("client with that email already exists")) {
          setServerEmailError("A client with that email already exists.");
          setEmailTouched(true);
          emailRef.current?.focus();
          return;
        }
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
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                Edit {client.name}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                Update contact details.
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

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <FieldLabel htmlFor="edit-client-name" required>
              Name
            </FieldLabel>
            <div>
              <input
                id="edit-client-name"
                type="text"
                required
                autoFocus={client.email.length > 0}
                autoComplete="name"
                value={name}
                maxLength={80}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                onBlur={() => {
                  setNameTouched(true);
                }}
                aria-invalid={nameState.kind === "invalid" || nameState.kind === "required"}
                placeholder="Artist or band name"
                className="w-full rounded-[var(--radius-md)] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--focus-ring))] focus:outline-none"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              />
              <ValidationHint state={nameState} />
            </div>

            <FieldLabel htmlFor="edit-client-email" required>
              Email
            </FieldLabel>
            <div>
              <input
                ref={emailRef}
                id="edit-client-email"
                type="email"
                required
                autoFocus={client.email.length === 0}
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setServerEmailError(null);
                }}
                onBlur={() => {
                  setEmailTouched(true);
                }}
                aria-invalid={
                  emailState.kind === "invalid" ||
                  emailState.kind === "required" ||
                  serverEmailError !== null
                }
                aria-describedby={serverEmailError ? "edit-client-email-server-error" : undefined}
                placeholder="they@example.com"
                className="w-full rounded-[var(--radius-md)] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--focus-ring))] focus:outline-none"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              />
              <ValidationHint state={emailState} />
              {serverEmailError ? (
                <p
                  id="edit-client-email-server-error"
                  role="alert"
                  className="mt-1 text-[11px] font-medium text-[rgb(var(--fg-danger-text))]"
                >
                  {serverEmailError}
                </p>
              ) : null}
            </div>

            <details
              open={moreOpen}
              onToggle={(event) => {
                setMoreOpen(event.currentTarget.open);
              }}
              className="group rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[13px] font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                More details
                <ChevronDown
                  size={15}
                  aria-hidden
                  className="text-[rgb(var(--fg-muted))] transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="flex flex-col gap-3 border-t border-[rgb(var(--border-subtle))] p-3">
                <FieldLabel htmlFor="edit-client-phone">Phone</FieldLabel>
                <input
                  id="edit-client-phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  maxLength={40}
                  onChange={(e) => {
                    setPhone(e.target.value);
                  }}
                  placeholder="+972 50 ..."
                  className="w-full rounded-[var(--radius-md)] border bg-[rgb(var(--bg-background))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--focus-ring))] focus:outline-none"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                />

                <FieldLabel htmlFor="edit-client-tags">Tags</FieldLabel>
                <div>
                  <input
                    id="edit-client-tags"
                    type="text"
                    value={tagsText}
                    maxLength={2000}
                    onChange={(e) => {
                      setTagsText(e.target.value);
                    }}
                    placeholder="Mixing, repeat client, priority"
                    aria-invalid={tagError !== null}
                    aria-describedby={
                      tagError
                        ? "edit-client-tags-hint edit-client-tags-error"
                        : "edit-client-tags-hint"
                    }
                    className="w-full rounded-[var(--radius-md)] border bg-[rgb(var(--bg-background))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--focus-ring))] focus:outline-none"
                    style={{ borderColor: "rgb(var(--border-subtle))" }}
                  />
                  <p
                    id="edit-client-tags-hint"
                    className="mt-1 text-[11px] text-[rgb(var(--fg-muted))]"
                  >
                    Separate with commas. Up to 20.
                  </p>
                  {tagError ? (
                    <p
                      id="edit-client-tags-error"
                      role="alert"
                      className="mt-1 text-[11px] font-medium text-[rgb(var(--fg-danger-text))]"
                    >
                      {tagError}
                    </p>
                  ) : null}
                </div>

                <FieldLabel htmlFor="edit-client-notes">Private producer notes</FieldLabel>
                <textarea
                  id="edit-client-notes"
                  value={notes}
                  rows={3}
                  maxLength={5000}
                  onChange={(e) => {
                    setNotes(e.target.value);
                  }}
                  placeholder="Genre, references, anything to remember..."
                  className="w-full resize-none rounded-[var(--radius-md)] border bg-[rgb(var(--bg-background))] px-3 py-2 text-[14px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--focus-ring))] focus:outline-none"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                />
              </div>
            </details>

            <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="sk-press inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                className="sk-press inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none"
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

export function parseClientTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const rawTag of value.split(",")) {
    const tag = rawTag.trim();
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

function validateClientTags(value: string): string | null {
  const rawTags = value.split(",").map((tag) => tag.trim());
  if (rawTags.some((tag) => tag.length > 80)) {
    return "Each tag must be 80 characters or fewer.";
  }
  if (parseClientTags(value).length > 20) {
    return "Use 20 tags or fewer.";
  }
  return null;
}

function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
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
      className="-mb-2.5 text-[10.5px] font-bold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
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
