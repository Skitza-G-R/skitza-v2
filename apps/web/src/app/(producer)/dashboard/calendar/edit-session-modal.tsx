"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

import type { SessionListItem } from "./session-row";

type TabId = "reschedule" | "reminder" | "cancel";

const EDIT_TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "reschedule", label: "Reschedule" },
  { id: "reminder", label: "Reminder" },
  { id: "cancel", label: "Cancel session" },
];

export function EditSessionModal({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  session: SessionListItem;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("reschedule");
  const end = new Date(new Date(session.startsAt).getTime() + session.durationMin * 60_000);
  const cannotCancel =
    session.status === "cancelled" || session.status === "rejected" || end.getTime() <= Date.now();

  useEffect(() => {
    if (!open) return;
    setActiveTab("reschedule");
  }, [open, session.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!gap-0 !p-0 sm:!max-w-[520px]">
        <DialogHeader className="px-6 pt-6 pb-4 sm:px-7 sm:pt-7">
          <DialogTitle className="text-[22px]">Edit session</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {session.packageName ?? "Session"} with {session.artistName}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 sm:px-7">
          <div
            role="tablist"
            aria-label="Session edit options"
            className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-1"
          >
            {EDIT_TABS.map((tab) => {
              const selected = activeTab === tab.id;
              const disabled = tab.id === "cancel" && cannotCancel;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`edit-session-tab-${tab.id}`}
                  aria-controls={`edit-session-panel-${tab.id}`}
                  aria-selected={selected}
                  disabled={disabled}
                  title={disabled ? "Completed or closed sessions cannot be cancelled" : undefined}
                  onClick={() => {
                    setActiveTab(tab.id);
                  }}
                  className={[
                    "sk-press inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] px-2 text-[11.5px] transition-colors focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
                    selected
                      ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9_/_0.08)]"
                      : tab.id === "cancel"
                        ? "text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.05)]"
                        : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
                  ].join(" ")}
                  style={{ fontWeight: 700 }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          role="tabpanel"
          id={`edit-session-panel-${activeTab}`}
          aria-labelledby={`edit-session-tab-${activeTab}`}
          className="min-h-[330px] px-6 pt-5 pb-6 sm:px-7 sm:pb-7"
        >
          {activeTab === "reschedule" ? (
            <ReschedulePanel
              session={session}
              onClose={() => {
                onOpenChange(false);
              }}
            />
          ) : activeTab === "reminder" ? (
            <ReminderPanel
              session={session}
              onClose={() => {
                onOpenChange(false);
              }}
            />
          ) : (
            <CancelPanel
              session={session}
              onClose={() => {
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReschedulePanel({ session, onClose }: { session: SessionListItem; onClose: () => void }) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationMin * 60_000);
  const initialDate = toDateInput(start);
  const initialStart = toTimeInput(start);
  const initialEnd = toTimeInput(end);
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const { toast } = useToast();
  const changed = date !== initialDate || startTime !== initialStart || endTime !== initialEnd;
  const valid = endTime.localeCompare(startTime) > 0;

  function updateStart(next: string) {
    setStartTime(next);
    if (endTime.localeCompare(next) <= 0) {
      setEndTime(addOneHour(next));
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <Field label="Date">
        <input
          type="date"
          aria-label="Date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
          className={fieldClassName}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start time">
          <TimeSelect label="Start time" value={startTime} onChange={updateStart} />
        </Field>
        <Field label="End time">
          <TimeSelect label="End time" value={endTime} onChange={setEndTime} />
        </Field>
      </div>
      {!valid ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.35)] bg-[rgb(var(--fg-danger)/0.05)] px-3 py-2 text-[11.5px] text-[rgb(var(--fg-danger))]"
        >
          End time must be after start time.
        </p>
      ) : null}
      <PanelFooter
        secondaryLabel="Close"
        primaryLabel="Save changes"
        disabled={!changed || !valid}
        onSecondary={onClose}
        onPrimary={() => {
          toast(
            "Reschedule wiring lands next sprint — saved your draft locally for review.",
            "info",
          );
          onClose();
        }}
      />
    </div>
  );
}

type Channel = "email" | "sms";
type Template = "friendly" | "formal" | "short";

const REMINDER_TEMPLATES: Record<Template, string> = {
  friendly: "Hey! Just a heads up — our session is coming up soon. Looking forward to it!",
  formal:
    "This is a friendly reminder of your upcoming session. Please confirm if anything has changed.",
  short: "Quick reminder: our session is coming up. See you soon.",
};

function ReminderPanel({ session, onClose }: { session: SessionListItem; onClose: () => void }) {
  const [channel, setChannel] = useState<Channel>("email");
  const [template, setTemplate] = useState<Template | null>("friendly");
  const [message, setMessage] = useState(REMINDER_TEMPLATES.friendly);
  const { toast } = useToast();

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {(["email", "sms"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={channel === item}
            onClick={() => {
              setChannel(item);
            }}
            className={[
              "sk-press h-10 rounded-[var(--radius-md)] border px-3 text-left text-[12px] capitalize transition-colors",
              channel === item
                ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.06)] text-[rgb(var(--fg-default))]"
                : "border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--border-strong))]",
            ].join(" ")}
            style={{ fontWeight: 700 }}
          >
            {item}
          </button>
        ))}
      </div>
      <Field label="Template">
        <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] p-1">
          {(["friendly", "formal", "short"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={template === item}
              onClick={() => {
                setTemplate(item);
                setMessage(REMINDER_TEMPLATES[item]);
              }}
              className={[
                "sk-press h-8 rounded-[var(--radius-sm)] text-[10.5px] capitalize transition-colors",
                template === item
                  ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9_/_0.08)]"
                  : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]",
              ].join(" ")}
              style={{ fontWeight: 700 }}
            >
              {item}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Message to ${session.artistName}`}>
        <textarea
          aria-label={`Message to ${session.artistName}`}
          rows={4}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            setTemplate(null);
          }}
          className="w-full resize-none rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[12.5px] leading-snug text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none"
        />
      </Field>
      <PanelFooter
        secondaryLabel="Close"
        primaryLabel="Send reminder"
        disabled={message.trim().length === 0}
        onSecondary={onClose}
        onPrimary={() => {
          toast("Manual reminders ship next sprint — saved your draft locally.", "info");
          onClose();
        }}
      />
    </div>
  );
}

type CancelReason =
  | "schedule_conflict"
  | "client_request"
  | "studio_unavailable"
  | "equipment_issue"
  | "other";

const CANCEL_REASONS: ReadonlyArray<{
  id: CancelReason;
  label: string;
}> = [
  { id: "schedule_conflict", label: "Schedule conflict" },
  { id: "client_request", label: "Client request" },
  { id: "studio_unavailable", label: "Studio unavailable" },
  { id: "equipment_issue", label: "Equipment issue" },
  { id: "other", label: "Other" },
];

function CancelPanel({ session, onClose }: { session: SessionListItem; onClose: () => void }) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState("");
  const { toast } = useToast();

  return (
    <div className="flex h-full flex-col gap-4">
      <p className="text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
        Cancelling frees the time slot and notifies {session.artistName}.
      </p>
      <Field label="Reason">
        <div className="grid grid-cols-2 gap-2">
          {CANCEL_REASONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-pressed={reason === item.id}
              onClick={() => {
                setReason(item.id);
              }}
              className={[
                "sk-press min-h-9 rounded-[var(--radius-md)] border px-3 py-2 text-left text-[11.5px] transition-colors",
                reason === item.id
                  ? "border-[rgb(var(--fg-danger)/0.6)] bg-[rgb(var(--fg-danger)/0.05)] text-[rgb(var(--fg-default))]"
                  : "border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))]",
              ].join(" ")}
              style={{ fontWeight: 650 }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Note for the artist (optional)">
        <textarea
          aria-label="Note for the artist"
          rows={3}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          placeholder="Add a short explanation."
          className="w-full resize-none rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[12.5px] leading-snug text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-faint))] focus:border-[rgb(var(--fg-danger))] focus:outline-none"
        />
      </Field>
      <PanelFooter
        secondaryLabel="Keep session"
        primaryLabel="Cancel session"
        primaryTone="danger"
        disabled={reason === null}
        onSecondary={onClose}
        onPrimary={() => {
          toast("Session cancellation ships next sprint — flagged this one for follow-up.", "info");
          onClose();
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span
        aria-hidden
        className="font-mono text-[9.5px] tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
        style={{ fontWeight: 700 }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className={fieldClassName}
    >
      {TIME_SLOTS.map((slot) => (
        <option key={slot} value={slot}>
          {slot}
        </option>
      ))}
    </select>
  );
}

function PanelFooter({
  secondaryLabel,
  primaryLabel,
  disabled,
  primaryTone = "dark",
  onSecondary,
  onPrimary,
}: {
  secondaryLabel: string;
  primaryLabel: string;
  disabled: boolean;
  primaryTone?: "dark" | "danger";
  onSecondary: () => void;
  onPrimary: () => void;
}) {
  return (
    <div className="mt-auto flex justify-end gap-2 border-t border-[rgb(var(--border-subtle))] pt-4">
      <button
        type="button"
        onClick={onSecondary}
        className="sk-press inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[12px] text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
        style={{ fontWeight: 650 }}
      >
        {secondaryLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onPrimary}
        className={[
          "sk-press inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] px-4 text-[12px] text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
          primaryTone === "danger" ? "bg-[rgb(var(--fg-danger))]" : "bg-[rgb(var(--fg-default))]",
        ].join(" ")}
        style={{ fontWeight: 700 }}
      >
        {primaryLabel}
      </button>
    </div>
  );
}

const fieldClassName =
  "h-10 w-full rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 font-mono text-[12px] text-[rgb(var(--fg-default))] focus:border-[rgb(var(--brand-primary))] focus:outline-none";

const TIME_SLOTS = Array.from({ length: 28 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

function toDateInput(date: Date): string {
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function toTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function addOneHour(time: string): string {
  const [hour = "0", minute = "0"] = time.split(":");
  const next = Math.min(Number(hour) * 60 + Number(minute) + 60, 21 * 60 + 30);
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}
