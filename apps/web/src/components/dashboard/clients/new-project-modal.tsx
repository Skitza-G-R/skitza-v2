"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SyntheticEvent, useEffect, useState, useTransition } from "react";

import { useToast } from "~/components/ui/toast";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import {
  ValidationHint,
  validateDisplayName,
  validateEmail,
  type ValidationState,
} from "~/components/ui/validation";
import { createProjectAction } from "~/app/(producer)/dashboard/clients-projects/clients-actions";

// New Project modal (Clients & Projects v3 redesign, Phase 1 G7).
// Replaces the legacy /dashboard/clients-projects/new route. The modal
// collects three fields:
//   1. Project title (required, autofocused, max 120)
//   2. Client picker — three sub-modes:
//      a) `lockedClient` prop set (opened from Client Space hero) → name
//         + email read-only, no picker
//      b) existing client picked from the dropdown
//      c) "+ New client" inline name + email; project.create resolves
//         this identity to a producer-owned stable client contact.
//   3. Deadline (optional, type="date")
//
// A project is a work container, not a commercial acceptance. Product,
// fee, and payment terms belong to immutable purchases and are not
// collected or inferred here.
//
// Submit flow: createProjectAction → revalidatePath → toast + router.refresh.
// On success the parent's onCreated() fires.
//
// Layout precedent: ../clients/new-client-modal.tsx — same Radix Dialog
// fixed-center, scrim + backdrop-blur, compact gap-3 form spacing, 5px
// padding, max-w-[460px].
// DESIGN.md §6.2 / BUILD-NOTES §7.2.

export interface NewProjectModalClientOption {
  id: string;
  name: string;
  email: string;
}

export interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing client list for the picker dropdown. */
  clients: NewProjectModalClientOption[];
  /**
   * When set, the client picker is locked — the modal renders the name
   * + email read-only. Used by the Client Space hero "+ New project"
   * pill so the producer can't accidentally repoint the project.
   */
  lockedClient?: NewProjectModalClientOption;
  /** Fired after a successful create — parent can refresh / close. */
  onCreated?: () => void;
}

type ClientMode = "existing" | "new";

export function NewProjectModal({
  open,
  onClose,
  clients,
  lockedClient,
  onCreated,
}: NewProjectModalProps) {
  const { toast } = useToast();
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);

  // Client picker state (only relevant when lockedClient is absent).
  // Default: pick existing when there are any, otherwise the inline
  // "+ New client" form so a first-time producer doesn't see an empty
  // dropdown.
  const [clientMode, setClientMode] = useState<ClientMode>(clients.length > 0 ? "existing" : "new");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientNameTouched, setNewClientNameTouched] = useState(false);
  const [newClientEmailTouched, setNewClientEmailTouched] = useState(false);

  const [deadline, setDeadline] = useState<string>(""); // YYYY-MM-DD

  // Reset form state every time the modal opens. Carrying values
  // across open/close is confusing — same convention as NewClientModal.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTitleTouched(false);
    setClientMode(clients.length > 0 ? "existing" : "new");
    setSelectedClientId("");
    setNewClientName("");
    setNewClientEmail("");
    setNewClientNameTouched(false);
    setNewClientEmailTouched(false);
    setDeadline("");
  }, [open]);

  const titleState: ValidationState = titleTouched ? validateDisplayName(title) : { kind: "idle" };
  const newClientNameState: ValidationState =
    clientMode === "new" && newClientNameTouched
      ? validateDisplayName(newClientName)
      : { kind: "idle" };
  const newClientEmailState: ValidationState =
    clientMode === "new" && newClientEmailTouched
      ? validateEmail(newClientEmail)
      : { kind: "idle" };

  // Submit guards. We disable if:
  // - title is blank
  // - client mode is "new" but name/email aren't filled
  // - client mode is "existing" but nothing selected (and no lockedClient)
  // - pending (request in flight)
  const submitDisabled = (() => {
    if (pending || !online) return true;
    if (title.trim().length === 0) return true;
    if (!lockedClient) {
      if (clientMode === "existing" && !selectedClientId) return true;
      if (clientMode === "new") {
        if (newClientName.trim().length === 0) return true;
        if (newClientEmail.trim().length === 0) return true;
      }
    }
    return false;
  })();

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTitleTouched(true);
    if (clientMode === "new" && !lockedClient) {
      setNewClientNameTouched(true);
      setNewClientEmailTouched(true);
    }
    const finalTitleState = validateDisplayName(title);
    if (finalTitleState.kind !== "valid") {
      return;
    }
    if (!online) {
      toast("Reconnect to create a project.", "error");
      return;
    }

    // Resolve the artist identity. lockedClient wins (Client Space
    // hero), then a selected existing client, then the inline new
    // form. If none of those resolved, we bail (this is also covered
    // by submitDisabled but defending the call here is cheap).
    let clientContactId: string | undefined;
    let newClient: { name: string; email: string } | undefined;
    if (lockedClient) {
      clientContactId = lockedClient.id;
    } else if (clientMode === "existing") {
      const picked = clients.find((c) => c.id === selectedClientId);
      if (!picked) return;
      clientContactId = picked.id;
    } else {
      const finalName = validateDisplayName(newClientName);
      const finalEmail = validateEmail(newClientEmail);
      if (finalName.kind !== "valid" || finalEmail.kind !== "valid") return;
      newClient = {
        name: newClientName.trim(),
        email: newClientEmail.trim(),
      };
    }

    startTransition(async () => {
      // exactOptionalPropertyTypes — never pass `undefined` keys.
      const payload: Parameters<typeof createProjectAction>[0] = {
        title: title.trim(),
        ...(clientContactId ? { clientContactId } : {}),
        ...(newClient ? { newClient } : {}),
      };
      if (deadline) {
        // <input type="date"> → "YYYY-MM-DD". Anchor at midnight UTC
        // so the column rounds cleanly across timezones.
        payload.deadlineAt = new Date(`${deadline}T00:00:00.000Z`).toISOString();
      }
      try {
        const res = await createProjectAction(payload);
        if (!res.ok) {
          toast(res.error, "error");
          return;
        }
        toast("Project created", "success");
        onCreated?.();
        router.refresh();
        onClose();
      } catch {
        toast("Could not create this project. Please try again.", "error");
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
          aria-describedby="new-project-modal-body"
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[18px] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                New project
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="new-project-modal-body"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                {lockedClient
                  ? `For ${lockedClient.name}`
                  : "Title, client, and an optional deadline."}
              </DialogPrimitive.Description>
            </div>
            <button
              type="button"
              aria-label="Close"
              onPointerDown={(event) => {
                event.preventDefault();
                onClose();
              }}
              onClick={onClose}
              className="-mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
            >
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            {/* Project title */}
            <FieldLabel htmlFor="new-project-title" required>
              Project title
            </FieldLabel>
            <div>
              <input
                id="new-project-title"
                type="text"
                required
                autoFocus
                value={title}
                maxLength={120}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                onBlur={() => {
                  setTitleTouched(true);
                }}
                aria-invalid={titleState.kind === "invalid" || titleState.kind === "required"}
                placeholder="Marcus T. — Full Production"
                className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              />
              <ValidationHint state={titleState} />
            </div>

            {/* Client picker — three modes (locked / existing / new) */}
            <FieldLabel htmlFor="new-project-client" required>
              Client
            </FieldLabel>
            {lockedClient ? (
              <div
                id="new-project-client"
                className="flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2"
                style={{
                  borderColor: "rgb(var(--border-subtle))",
                  background: "rgb(var(--bg-elevated))",
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-[rgb(var(--fg-default))]">
                    {lockedClient.name}
                  </p>
                  <p className="truncate text-[12px] text-[rgb(var(--fg-muted))]">
                    {lockedClient.email}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {clientMode === "existing" ? (
                  <>
                    <select
                      id="new-project-client"
                      value={selectedClientId}
                      onChange={(e) => {
                        setSelectedClientId(e.target.value);
                      }}
                      className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                      style={{ borderColor: "rgb(var(--border-subtle))" }}
                    >
                      <option value="">Pick a client…</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.email})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setClientMode("new");
                      }}
                      className="self-start text-[12px] font-semibold text-[rgb(var(--brand-primary))] hover:underline"
                    >
                      + New client
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <input
                        id="new-project-client-name"
                        type="text"
                        value={newClientName}
                        maxLength={80}
                        onChange={(e) => {
                          setNewClientName(e.target.value);
                        }}
                        onBlur={() => {
                          setNewClientNameTouched(true);
                        }}
                        aria-invalid={
                          newClientNameState.kind === "invalid" ||
                          newClientNameState.kind === "required"
                        }
                        placeholder="Artist or band name"
                        className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                        style={{ borderColor: "rgb(var(--border-subtle))" }}
                      />
                      <ValidationHint state={newClientNameState} />
                    </div>
                    <div>
                      <input
                        id="new-project-client-email"
                        type="email"
                        value={newClientEmail}
                        onChange={(e) => {
                          setNewClientEmail(e.target.value);
                        }}
                        onBlur={() => {
                          setNewClientEmailTouched(true);
                        }}
                        aria-invalid={
                          newClientEmailState.kind === "invalid" ||
                          newClientEmailState.kind === "required"
                        }
                        placeholder="they@example.com"
                        className="w-full rounded-[10px] border bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                        style={{ borderColor: "rgb(var(--border-subtle))" }}
                      />
                      <ValidationHint state={newClientEmailState} />
                    </div>
                    {clients.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setClientMode("existing");
                        }}
                        className="self-start text-[12px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
                      >
                        ← Pick an existing client
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )}

            <details className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
              <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary)/0.6)] focus-visible:outline-none focus-visible:ring-inset">
                Add deadline
              </summary>
              <div className="grid gap-3 border-t border-[rgb(var(--border-subtle))] p-3">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="new-project-deadline">Deadline</FieldLabel>
                  <input
                    id="new-project-deadline"
                    type="date"
                    value={deadline}
                    onChange={(e) => {
                      setDeadline(e.target.value);
                    }}
                    className="w-full rounded-[10px] border bg-[rgb(var(--bg-background))] px-3 py-2 text-[14px] text-[rgb(var(--fg-default))] focus:ring-2 focus:ring-[rgb(var(--brand-primary)/0.6)] focus:outline-none"
                    style={{ borderColor: "rgb(var(--border-subtle))" }}
                  />
                </div>
              </div>
            </details>

            <div className="sticky bottom-0 -mx-5 mt-1 -mb-5 flex flex-col-reverse gap-2 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50 sm:min-h-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-4 py-2 text-[13px] font-semibold text-[rgb(17_16_9)] shadow-[0_4px_14px_-2px_rgb(var(--brand-primary)/0.5)] disabled:opacity-50 disabled:shadow-none sm:min-h-0"
                style={{ background: "rgb(var(--brand-primary))" }}
              >
                {pending ? "Creating…" : "Create project"}
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
