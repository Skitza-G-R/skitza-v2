"use client";

// CancelSessionModal — UI-only. Backend doesn't expose a `booking.cancel`
// proc yet (only confirm + reject for pending; no path for confirmed
// sessions). Submitting toasts "Coming soon"; the design polish stays
// so producers can see the workflow.

import { useEffect, useState } from "react";

import { useToast } from "~/components/ui/toast";

import {
  ModalGhostButton,
  ModalPrimaryButton,
  SessionModalShell,
} from "./session-modal-shell";
import type { SessionListItem } from "./session-row";

type Reason =
  | "schedule_conflict"
  | "client_request"
  | "studio_unavailable"
  | "equipment_issue"
  | "other";

const REASON_OPTIONS: ReadonlyArray<{ id: Reason; label: string }> = [
  { id: "schedule_conflict", label: "Schedule conflict" },
  { id: "client_request", label: "Client request" },
  { id: "studio_unavailable", label: "Studio unavailable" },
  { id: "equipment_issue", label: "Equipment issue" },
  { id: "other", label: "Other" },
];

export function CancelSessionModal({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  session: SessionListItem;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
  }, [open]);

  function handleSubmit() {
    toast(
      "Session cancellation ships next sprint — flagged this one for follow-up.",
      "info",
    );
    onOpenChange(false);
  }

  return (
    <SessionModalShell
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      eyebrow="CANCEL SESSION"
      title={`Cancel ${session.packageName ?? "session"}?`}
      subtitle={`This frees the slot and notifies ${session.artistName}. They keep any deposit on file.`}
      icon={<XCircleIcon />}
      body={
        <>
          <div>
            <p
              className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
              style={{ fontWeight: 700 }}
            >
              Reason
            </p>
            <div className="grid grid-cols-2 gap-2">
              {REASON_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setReason(opt.id);
                  }}
                  aria-pressed={reason === opt.id}
                  className={[
                    "sk-press flex items-center justify-between rounded-[10px] border px-3 py-2 text-left text-[12px] transition-colors",
                    reason === opt.id
                      ? "border-[rgb(var(--fg-danger)/0.6)] bg-[rgb(var(--fg-danger)/0.05)] text-[rgb(var(--fg-default))]"
                      : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))]",
                  ].join(" ")}
                  style={{ fontWeight: 600 }}
                >
                  {opt.label}
                  {reason === opt.id ? <CheckIcon /> : null}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span
              className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
              style={{ fontWeight: 700 }}
            >
              Note for the artist (optional)
            </span>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              placeholder="Sorry to do this — let's reschedule for next week."
              className="w-full resize-none rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[12.5px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--fg-danger))] focus:outline-none"
            />
          </label>
        </>
      }
      footer={
        <>
          <ModalGhostButton
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Keep session
          </ModalGhostButton>
          <ModalPrimaryButton
            onClick={handleSubmit}
            disabled={reason === null}
            tone="danger"
          >
            Cancel session
          </ModalPrimaryButton>
        </>
      }
    />
  );
}

function XCircleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-[rgb(var(--fg-danger))]"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
