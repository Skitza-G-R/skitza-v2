"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { updateAvailabilitySettings } from "./actions";

// Surfaces the producer-level booking policies: auto-confirm switch
// (new public bookings land in `confirmed` instead of `pending`) and
// cancellation policy (hours of advance notice the artist must give
// to cancel). Stored today; the cancel-by-artist enforcement path is
// a follow-up task.

const MIN_CANCELLATION_HOURS = 0;
const MAX_CANCELLATION_HOURS = 7 * 24; // 1 week — sane spinner cap

export function PoliciesEditor({
  initialAutoConfirm,
  initialCancellationHours,
}: {
  initialAutoConfirm: boolean;
  initialCancellationHours: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [autoConfirm, setAutoConfirm] = useState(initialAutoConfirm);
  const [hours, setHours] = useState(initialCancellationHours);
  const [hoursDraft, setHoursDraft] = useState(String(initialCancellationHours));

  function saveAutoConfirm(next: boolean) {
    if (next === autoConfirm) return;
    const prev = autoConfirm;
    setAutoConfirm(next);
    startTransition(async () => {
      const res = await updateAvailabilitySettings({ autoConfirmBookings: next });
      if (res.ok) {
        toast(
          next
            ? "Auto-confirm on — bookings skip manual approval."
            : "Auto-confirm off — you'll review new requests.",
          "success",
        );
        router.refresh();
      } else {
        setAutoConfirm(prev);
        toast(res.error, "error");
      }
    });
  }

  function saveHours() {
    const parsed = Number.parseInt(hoursDraft, 10);
    if (!Number.isFinite(parsed)) {
      toast("Enter a number of hours.", "error");
      setHoursDraft(String(hours));
      return;
    }
    if (parsed < MIN_CANCELLATION_HOURS || parsed > MAX_CANCELLATION_HOURS) {
      toast(
        `Policy must be between ${String(MIN_CANCELLATION_HOURS)} and ${String(MAX_CANCELLATION_HOURS)} hours.`,
        "error",
      );
      setHoursDraft(String(hours));
      return;
    }
    if (parsed === hours) return;
    const prev = hours;
    setHours(parsed);
    startTransition(async () => {
      const res = await updateAvailabilitySettings({
        cancellationPolicyHours: parsed,
      });
      if (res.ok) {
        toast("Cancellation policy saved.", "success");
        router.refresh();
      } else {
        setHours(prev);
        setHoursDraft(String(prev));
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
      <div className="mb-4">
        <h3
          className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Booking policies
        </h3>
        <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
          How requests flow through your inbox and how much notice cancellations need.
        </p>
      </div>

      {/* Auto-confirm row */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[rgb(var(--border-subtle))] pb-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[rgb(var(--fg-primary))]" style={{ fontWeight: 600 }}>
            Auto-confirm bookings
          </p>
          <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
            New bookings are confirmed automatically without manual approval. The artist
            gets a confirmation email instantly.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoConfirm}
          aria-label="Auto-confirm bookings"
          disabled={pending}
          onClick={() => {
            saveAutoConfirm(!autoConfirm);
          }}
          className={[
            "relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
            autoConfirm
              ? "bg-[rgb(var(--brand-primary))]"
              : "bg-[rgb(var(--fg-muted)/0.3)]",
            pending ? "opacity-60" : "",
          ].join(" ")}
        >
          <span
            aria-hidden
            className={[
              "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
              autoConfirm ? "translate-x-6" : "translate-x-1",
            ].join(" ")}
          />
        </button>
      </div>

      {/* Cancellation policy row */}
      <div className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[rgb(var(--fg-primary))]" style={{ fontWeight: 600 }}>
              Cancellation policy
            </p>
            <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
              Hours in advance an artist must give to cancel. We&apos;ll enforce it in
              the artist&apos;s cancel flow (coming soon); for now it shows in the
              confirmation email.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="cancellation-hours" className="sr-only">
                Cancellation hours
              </Label>
              <Input
                id="cancellation-hours"
                type="number"
                inputMode="numeric"
                min={MIN_CANCELLATION_HOURS}
                max={MAX_CANCELLATION_HOURS}
                step={1}
                value={hoursDraft}
                onChange={(e) => {
                  setHoursDraft(e.target.value);
                }}
                onBlur={saveHours}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveHours();
                  }
                }}
                className="w-24 font-mono text-base"
                disabled={pending}
              />
            </div>
            <span className="pb-2 text-sm text-[rgb(var(--fg-muted))]">hours</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-h-11"
              onClick={saveHours}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
