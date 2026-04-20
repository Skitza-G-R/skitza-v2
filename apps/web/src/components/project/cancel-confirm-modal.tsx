"use client";

// Cancel-project confirmation modal — destructive, hard friction by
// design. The producer must type the project title verbatim before the
// "Cancel project" button enables. Cancelling stops all future Stripe
// charges (monthly subscription schedule cancelled on Stripe's side)
// and cannot be reversed in-app. The matching tRPC mutation also
// validates the title server-side, so this guard is UX, not security.
//
// Refund policy: we DO NOT issue refunds in-app. The contract governs
// (per the design doc); if a refund is owed, the producer issues it
// from the Stripe Dashboard. Copy below makes that explicit so the
// producer doesn't expect a refund as a side-effect.
//
// Mirrors confirm-charge-modal.tsx for tokens + spacing + a11y shell.

import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";

interface CancelConfirmModalProps {
  open: boolean;
  projectTitle: string;
  /** Mutation invocation. Must throw on failure so the modal renders the error inline. */
  onConfirm: (confirmTitle: string) => Promise<void>;
  onClose: () => void;
}

export function CancelConfirmModal({
  open,
  projectTitle,
  onConfirm,
  onClose,
}: CancelConfirmModalProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // Reset transient state when re-opened — stale "match the title"
  // text from a previous attempt would mislead the next session.
  useEffect(() => {
    if (open) {
      setError(null);
      setTyped("");
    }
  }, [open]);

  // Esc closes only when idle; once the mutation is in-flight we
  // refuse to dismiss so the producer doesn't lose track of whether
  // Stripe was called.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, pending, onClose]);

  if (!open) return null;

  // Exact match (server-side enforces the same rule). No trim — extra
  // whitespace counts as a typo, and we'd rather force a re-type than
  // silently accept a near-match.
  const matches = typed === projectTitle;

  async function handleConfirm() {
    if (!matches) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(typed);
      setPending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed.");
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-project-title"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => {
          if (!pending) onClose();
        }}
        disabled={pending}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm disabled:cursor-not-allowed"
      />
      <div className="sk-pop-center relative w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-2xl">
        <h2
          id="cancel-project-title"
          className="font-display text-xl text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Cancel this project?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
          Here&rsquo;s what happens to{" "}
          <strong className="font-semibold text-[rgb(var(--fg-primary))]">
            {projectTitle}
          </strong>
          :
        </p>
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-[rgb(var(--fg-danger))]">
              •
            </span>
            <span>All future scheduled charges stop.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-[rgb(var(--fg-muted))]">
              •
            </span>
            <span>Existing work and paid invoices stay as they are.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-[rgb(var(--fg-muted))]">
              •
            </span>
            <span>
              Refunds aren&rsquo;t issued automatically — handle those in
              Stripe based on your contract.
            </span>
          </li>
        </ul>

        <div className="mt-5">
          <Label htmlFor="cancel-confirm-input">
            Type the project name to confirm:{" "}
            <span className="font-mono text-[rgb(var(--fg-primary))]">
              {projectTitle}
            </span>
          </Label>
          <Input
            id="cancel-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            // autoFocus mirrors confirm-charge-modal — the producer is
            // already in destructive-action mode, give them the input
            // immediately rather than forcing a tab.
            autoFocus
          />
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2"
          >
            <p className="text-sm text-[rgb(var(--fg-danger))]">{error}</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            Keep project
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void handleConfirm();
            }}
            // Triple gate: title must match + not already pending. The
            // server runs the same check, but the disabled state is the
            // visible signal that "you're not done with the gesture".
            disabled={pending || !matches}
          >
            {pending ? "Cancelling…" : "Cancel project"}
          </Button>
        </div>
      </div>
    </div>
  );
}
