"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AdminEnvironmentId } from "~/server/environment";
import styles from "./registered-users.module.css";

function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

type ReconciliationPage = Readonly<{
  applied: number;
  complete: boolean;
  nextCursor: string | null;
  replayed: boolean;
  seen: number;
  skipped: number;
}>;

function isReconciliationPage(value: unknown): value is ReconciliationPage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const page = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(page.applied) &&
    typeof page.complete === "boolean" &&
    (page.nextCursor === null || typeof page.nextCursor === "string") &&
    typeof page.replayed === "boolean" &&
    Number.isSafeInteger(page.seen) &&
    Number.isSafeInteger(page.skipped)
  );
}

export function ReconcileRegisteredUsers({ environment }: { environment: AdminEnvironmentId }) {
  const router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    "Reads Clerk and refreshes this support index. It never changes Clerk.",
  );

  async function runPage() {
    const requestKey = key ?? operationKey("registered-users-reconcile");
    setKey(requestKey);
    setPending(true);
    setMessage("Checking one safe page in Clerk…");
    const query = new URLSearchParams({ environment });
    if (cursor) query.set("cursor", cursor);

    try {
      const response = await fetch(`/api/admin/users/reconcile?${query}`, {
        cache: "no-store",
        headers: { "idempotency-key": requestKey },
        method: "POST",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isReconciliationPage(payload)) {
        if (response.status === 400) {
          setCursor(null);
          setKey(null);
        }
        setMessage(
          response.status === 400
            ? "This refresh page expired. Start again."
            : "Clerk refresh is unavailable right now. Nothing was changed; retry safely.",
        );
        return;
      }

      setCursor(payload.nextCursor);
      setKey(null);
      router.refresh();
      if (payload.complete) {
        setMessage(
          `Refresh complete · ${String(payload.seen)} checked · ${String(payload.applied)} updated.`,
        );
      } else {
        setMessage(
          `${String(payload.seen)} checked · ${String(payload.applied)} updated. Continue for the next page.`,
        );
      }
    } catch {
      setMessage("Network interrupted. Nothing unsafe happened; retry this page.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.reconcile}>
      <button
        className={styles.secondaryButton}
        disabled={pending}
        onClick={() => {
          void runPage();
        }}
        type="button"
      >
        {pending ? "Refreshing…" : cursor ? "Continue refresh" : "Refresh from Clerk"}
      </button>
      <span aria-live="polite">{message}</span>
    </div>
  );
}

export function CopyUserId({ userId }: { userId: string }) {
  const [message, setMessage] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(userId);
      setMessage("Copied");
    } catch {
      setMessage("Select the ID below to copy it");
    }
  }

  return (
    <span className={styles.copyControl}>
      <button
        className={styles.quietButton}
        onClick={() => {
          void copy();
        }}
        type="button"
      >
        Copy ID
      </button>
      {message ? <small aria-live="polite">{message}</small> : null}
    </span>
  );
}

type ProducerInvitationResult = Readonly<{
  invitationId: string;
  reused: boolean;
  status: "accepted" | "pending";
}>;

function isProducerInvitationResult(value: unknown): value is ProducerInvitationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.invitationId === "string" &&
    typeof result.reused === "boolean" &&
    (result.status === "accepted" || result.status === "pending")
  );
}

export function ProducerInvitationControl({
  displayEmail,
  environment,
  userId,
}: {
  displayEmail: string | null;
  environment: AdminEnvironmentId;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [inviteKey, setInviteKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const environmentLabel = environment === "live" ? "Live" : "Test";

  async function sendInvitation() {
    const requestKey = inviteKey ?? operationKey("producer-invitation-create");
    setInviteKey(requestKey);
    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/producer-invitations?environment=${environment}`,
        {
          body: "{}",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "idempotency-key": requestKey,
          },
          method: "POST",
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isProducerInvitationResult(payload)) {
        setError(
          response.status === 409
            ? "This account is no longer eligible for a Producer invitation."
            : response.status === 423
              ? "The admin session is locked. Refresh and unlock before retrying."
              : "The invitation was not confirmed. Retry safely with the same button.",
        );
        return;
      }

      setInviteKey(null);
      setOpen(false);
      setMessage(
        payload.status === "accepted"
          ? "This Producer invitation was already accepted."
          : payload.reused
            ? "A marked Producer invitation is already pending for this email."
            : `Producer invitation sent from ${environmentLabel}. It expires in 7 days.`,
      );
    } catch {
      setError("The invitation was not confirmed because the network stopped. Retry safely.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.producerInviteControl}>
      {open ? (
        <div className={styles.producerInviteConfirmation}>
          <strong>Send a real {environmentLabel} invitation?</strong>
          <p>
            Clerk will email this account’s current verified primary email.
            {displayEmail ? ` The admin index shows ${displayEmail}.` : ""} Their Artist access
            stays active.
          </p>
          <div className={styles.inlineActions}>
            <button
              className={styles.primaryButton}
              disabled={pending}
              onClick={() => {
                void sendInvitation();
              }}
              type="button"
            >
              {pending ? "Sending…" : `Send ${environmentLabel} invitation`}
            </button>
            <button
              className={styles.quietButton}
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className={styles.secondaryButton}
          onClick={() => {
            setOpen(true);
            setError(null);
            setMessage(null);
          }}
          type="button"
        >
          Invite as Producer
        </button>
      )}
      {message ? (
        <p className={styles.inlineSuccess} role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type RevealedNote = Readonly<{
  body: string;
  createdAt: string;
}>;

function isRevealedNote(value: unknown): value is RevealedNote {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const note = value as Record<string, unknown>;
  return typeof note.body === "string" && typeof note.createdAt === "string";
}

export function RevealSupportNote({
  environment,
  noteId,
  userId,
}: {
  environment: AdminEnvironmentId;
  noteId: string;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<"" | "safety_issue" | "support_investigation">("");
  const [note, setNote] = useState<RevealedNote | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);

  async function reveal() {
    if (!reason) {
      setError("Choose why you need to view this private note.");
      return;
    }
    setPending(true);
    setError(null);
    const requestKey = revealKey ?? operationKey("support-note-reveal");
    setRevealKey(requestKey);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/support-notes/${encodeURIComponent(noteId)}/reveal?environment=${environment}`,
        {
          body: JSON.stringify({ reason }),
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            "idempotency-key": requestKey,
          },
          method: "POST",
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRevealedNote(payload)) {
        setError(
          response.status === 404
            ? "This note is no longer available."
            : "The note stayed hidden. Try again.",
        );
        return;
      }
      setNote(payload);
      setRevealKey(null);
    } catch {
      setError("The note stayed hidden because the network was interrupted.");
    } finally {
      setPending(false);
    }
  }

  if (note) {
    return (
      <div className={styles.revealedNote}>
        <div className={styles.revealedNoteHeader}>
          <strong>Private note</strong>
          <button
            className={styles.quietButton}
            onClick={() => {
              setNote(null);
              setOpen(false);
              setReason("");
              setRevealKey(null);
            }}
            type="button"
          >
            Hide
          </button>
        </div>
        <p>{note.body}</p>
        <small>Visible only in this tab until you hide or leave this page.</small>
      </div>
    );
  }

  return (
    <div className={styles.revealControl}>
      {open ? (
        <>
          <label>
            <span>Reason for viewing</span>
            <select
              onChange={(event) => {
                setRevealKey(null);
                setError(null);
                setReason(
                  event.currentTarget.value as "" | "safety_issue" | "support_investigation",
                );
              }}
              value={reason}
            >
              <option value="">Choose a reason</option>
              <option value="support_investigation">Support investigation</option>
              <option value="safety_issue">Safety issue</option>
            </select>
          </label>
          <div className={styles.inlineActions}>
            <button
              className={styles.primaryButton}
              disabled={pending}
              onClick={() => {
                void reveal();
              }}
              type="button"
            >
              {pending ? "Recording audit…" : "Record reason & reveal"}
            </button>
            <button
              className={styles.quietButton}
              onClick={() => {
                setOpen(false);
                setError(null);
                setReason("");
                setRevealKey(null);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          className={styles.quietButton}
          onClick={() => {
            setOpen(true);
          }}
          type="button"
        >
          Reveal private note
        </button>
      )}
      {error ? (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
