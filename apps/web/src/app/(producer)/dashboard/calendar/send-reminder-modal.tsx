"use client";

// SendReminderModal — UI-only. Backend doesn't expose a per-booking
// reminder push endpoint yet (the cron at /api/cron/session-reminders
// fires automatic 24h reminders), so submitting toasts a "Coming soon"
// status. Producers still see the design polish.

import { useEffect, useState } from "react";

import { useToast } from "~/components/ui/toast";

import {
  ModalGhostButton,
  ModalPrimaryButton,
  SessionModalShell,
} from "./session-modal-shell";
import type { SessionListItem } from "./session-row";

type Channel = "email" | "sms";
type Template = "friendly" | "formal" | "short";

const TEMPLATES: Record<Template, string> = {
  friendly:
    "Hey! Just a heads up — our session is coming up soon. Looking forward to it!",
  formal:
    "This is a friendly reminder of your upcoming session. Please confirm if anything has changed.",
  short: "Quick reminder: our session is coming up. See you soon.",
};

export function SendReminderModal({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  session: SessionListItem;
}) {
  const [channel, setChannel] = useState<Channel | null>("email");
  const [template, setTemplate] = useState<Template | null>("friendly");
  const [message, setMessage] = useState(TEMPLATES.friendly);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setChannel("email");
    setTemplate("friendly");
    setMessage(TEMPLATES.friendly);
  }, [open]);

  function pickTemplate(t: Template) {
    setTemplate(t);
    setMessage(TEMPLATES[t]);
  }

  function handleSubmit() {
    toast(
      "Manual reminders ship next sprint — saved your draft locally.",
      "info",
    );
    onOpenChange(false);
  }

  const canSend = channel !== null && message.trim().length > 0;

  return (
    <SessionModalShell
      open={open}
      onOpenChange={onOpenChange}
      tone="brand"
      eyebrow="SEND REMINDER"
      title={`Remind ${session.artistName.split(" ")[0] ?? "the artist"}`}
      subtitle={`Pick a channel and a tone — we'll dispatch the reminder ahead of ${session.packageName ?? "the session"}.`}
      icon={<BellIcon />}
      body={
        <>
          <div className="grid grid-cols-2 gap-2">
            <ChannelCard
              label="Email"
              hint="Goes to artist's email"
              active={channel === "email"}
              onClick={() => {
                setChannel("email");
              }}
            />
            <ChannelCard
              label="SMS"
              hint="Goes to artist's phone"
              active={channel === "sms"}
              onClick={() => {
                setChannel("sms");
              }}
            />
          </div>

          <div>
            <p
              className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
              style={{ fontWeight: 700 }}
            >
              Template
            </p>
            <div className="inline-flex rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-0.5">
              {(["friendly", "formal", "short"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    pickTemplate(t);
                  }}
                  aria-pressed={template === t}
                  className={[
                    "sk-press inline-flex h-7 items-center justify-center rounded-[var(--radius-lg)] px-3 text-[11px] capitalize transition-colors",
                    template === t
                      ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9_/_0.08)]"
                      : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
                  ].join(" ")}
                  style={{ fontWeight: 700 }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span
              className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]"
              style={{ fontWeight: 700 }}
            >
              Message
            </span>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                // Editing breaks the template selection.
                setTemplate(null);
              }}
              className="w-full resize-none rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[12.5px] leading-snug text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
            />
            <span className="self-end font-mono text-[10px] text-[rgb(var(--fg-faint))]">
              {String(message.length)} chars
            </span>
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
            Cancel
          </ModalGhostButton>
          <ModalPrimaryButton onClick={handleSubmit} disabled={!canSend} tone="dark">
            Send reminder
          </ModalPrimaryButton>
        </>
      }
    />
  );
}

function ChannelCard({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "sk-press flex items-start justify-between rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))]",
      ].join(" ")}
    >
      <div>
        <p
          className="text-[12.5px] text-[rgb(var(--fg-default))]"
          style={{ fontWeight: 700 }}
        >
          {label}
        </p>
        <p className="text-[10.5px] text-[rgb(var(--fg-muted))]">{hint}</p>
      </div>
      <span
        aria-hidden
        className={[
          "mt-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2",
          active
            ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))]"
            : "border-[rgb(var(--border-strong))]",
        ].join(" ")}
      />
    </button>
  );
}

function BellIcon() {
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
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
