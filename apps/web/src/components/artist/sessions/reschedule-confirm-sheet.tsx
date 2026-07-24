"use client";

// S12 inline bottom sheet for an on-time artist cancellation. The stable
// operation key makes retries safe if the connection drops after the server
// commits the cancellation.

import { useRef, useState } from "react";

import { Check, CloseIcon } from "~/components/artist/funnel/funnel-icons";
import { cancelSessionAction } from "~/app/(artist)/artist/sessions/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";

export function RescheduleConfirmSheet({
  sessionId,
  producerName,
  onClose,
  onCancelled,
}: {
  sessionId: string;
  producerName: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const online = useOnlineStatus();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationKeyRef = useRef<string | null>(null);

  async function confirm() {
    if (confirming) return;
    if (!online) {
      setError("Reconnect before canceling. Your session is still booked.");
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      operationKeyRef.current ??= crypto.randomUUID();
      const result = await cancelSessionAction({
        id: sessionId,
        operationKey: operationKeyRef.current,
      });
      if (!result.ok) {
        setConfirming(false);
        setError(result.error);
        return;
      }
      onCancelled();
    } catch {
      setConfirming(false);
      setError("Couldn't do that just now. Check your connection and try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Cancel session"
    >
      {/* scrim */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={confirming ? undefined : onClose}
        className="absolute inset-0"
        style={{ background: "rgb(17 16 9 / 0.42)", backdropFilter: "blur(2px)" }}
      />

      {/* sheet */}
      <div
        className="animate-slide-up-modal sk-safe-bottom relative w-full max-w-[440px] rounded-t-[var(--radius-2xl)] px-5 pt-4 pb-5"
        style={{
          background: "rgb(var(--bg-elevated))",
          borderTop: "1px solid rgb(var(--border-subtle))",
          boxShadow: "0 -20px 50px -16px rgb(17 16 9 / 0.35)",
        }}
      >
        {/* grabber */}
        <div
          className="mx-auto mb-3.5 h-1 w-9 rounded-full"
          style={{ background: "rgb(var(--border-strong))" }}
        />

        <div className="flex items-start gap-3.5">
          <span
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full"
            style={{
              background: "rgb(var(--fg-danger) / 0.1)",
              color: "rgb(var(--fg-danger))",
            }}
          >
            <CloseIcon width={20} height={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-syne text-[18px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
              Cancel this session?
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
              {producerName} will be notified, and this use returns to your session allowance. Any
              refund follows your signed agreement, off-app.
            </p>
          </div>
        </div>

        {error ? (
          <p
            className="mt-3.5 rounded-[12px] px-3.5 py-2.5 text-center text-[12.5px] font-medium"
            style={{
              background: "rgb(var(--fg-danger) / 0.1)",
              color: "rgb(var(--fg-danger))",
            }}
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => {
              void confirm();
            }}
            disabled={confirming || !online}
            className={`relative flex w-full items-center justify-center gap-[9px] rounded-[var(--radius-lg)] px-[22px] py-[15px] text-[15px] font-semibold ${
              confirming || !online ? "cursor-not-allowed opacity-80" : "sk-press"
            }`}
            style={{
              background: "rgb(var(--fg-danger))",
              color: "white",
            }}
          >
            {confirming ? (
              <>
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 motion-reduce:animate-none"
                  style={{ borderColor: "rgb(255 255 255 / 0.35)", borderTopColor: "white" }}
                />
                Cancelling…
              </>
            ) : !online ? (
              "Reconnect to cancel"
            ) : (
              <>
                <Check width={16} height={16} /> Yes, cancel it
              </>
            )}
          </button>
          <button
            type="button"
            onClick={confirming ? undefined : onClose}
            disabled={confirming}
            className="sk-press flex w-full items-center justify-center rounded-[var(--radius-lg)] px-[22px] py-[13px] text-[14px] font-semibold text-[rgb(var(--fg-secondary))]"
          >
            Keep my session
          </button>
        </div>
      </div>
    </div>
  );
}
