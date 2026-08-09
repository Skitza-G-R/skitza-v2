"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

import { decideSessionChangeRequest } from "./calendar-actions";
import { formatCalendarDate, formatCalendarTime } from "./calendar-time";
import type { SessionListItem } from "./session-row";

export function ChangeRequestDecision({
  session,
  timeZone,
  compact = false,
}: {
  session: SessionListItem;
  timeZone: string;
  compact?: boolean;
}) {
  const request = session.changeRequest;
  const [isPending, startTransition] = useTransition();
  const operationKeys = useRef<Record<"approved" | "rejected", string | null>>({
    approved: null,
    rejected: null,
  });
  const router = useRouter();
  const online = useOnlineStatus();
  const { toast } = useToast();

  if (!request) return null;

  const proposedStart = request.proposedStartsAt ? new Date(request.proposedStartsAt) : null;
  const description =
    request.kind === "reschedule" && proposedStart
      ? `Move to ${formatCalendarDate(proposedStart, timeZone)} at ${formatCalendarTime(proposedStart, timeZone)}`
      : "Cancel this session under its saved cancellation policy";

  function decide(decision: "approved" | "rejected") {
    if (!request || !online || isPending) return;
    const operationKey =
      operationKeys.current[decision] ??
      `producer-change-request:${request.id}:${decision}:${crypto.randomUUID()}`;
    operationKeys.current[decision] = operationKey;
    startTransition(async () => {
      const result = await decideSessionChangeRequest({
        requestId: request.id,
        decision,
        operationKey,
      });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      const reducedProtection =
        decision === "approved" &&
        request.kind === "reschedule" &&
        result.googleCalendarProtection === "reduced";
      toast(
        reducedProtection
          ? "Artist request approved. Google busy-time protection was limited for this check."
          : decision === "approved"
            ? "Artist request approved."
            : "Artist request declined.",
        reducedProtection ? "info" : "success",
      );
      router.refresh();
    });
  }

  return (
    <div
      className={[
        "rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)]",
        compact ? "p-2.5" : "p-3.5",
      ].join(" ")}
      role="group"
      aria-label={`${request.kind === "reschedule" ? "Reschedule" : "Cancellation"} request from ${session.artistName}`}
    >
      <p className="font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary-dark))] uppercase">
        Artist request
      </p>
      <p className="mt-1 text-[12px] leading-snug font-semibold text-[rgb(var(--fg-default))]">
        {description}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[rgb(var(--fg-muted))]">
        The current session stays unchanged unless you approve.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={isPending || !online}
          onClick={() => {
            decide("rejected");
          }}
          className="sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-3 text-xs font-bold text-[rgb(var(--fg-secondary))] disabled:cursor-not-allowed disabled:opacity-50 lg:h-9"
        >
          {isPending ? "Saving…" : "Decline"}
        </button>
        <button
          type="button"
          disabled={isPending || !online}
          onClick={() => {
            decide("approved");
          }}
          className="sk-cta-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-xs font-bold text-[rgb(var(--bg-sidebar))] disabled:cursor-not-allowed disabled:opacity-50 lg:h-9"
        >
          {isPending ? "Saving…" : "Approve"}
        </button>
      </div>
      {!online ? (
        <p className="mt-2 text-[11px] text-[rgb(var(--fg-danger-text))]">
          Reconnect to decide this request.
        </p>
      ) : null}
    </div>
  );
}
