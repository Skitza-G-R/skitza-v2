"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cancelSessionAction } from "~/app/(artist)/artist/sessions/actions";
import { CloseIcon } from "~/components/artist/funnel/funnel-icons";
import { FunnelTopBar } from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";

export function CancelSessionScreen({
  sessionId,
  producerId,
  producerName,
  canCancel,
  held,
}: {
  sessionId: string;
  producerId: string;
  producerName: string;
  canCancel: boolean;
  held: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const operationKey = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailHref = withArtistStudio(`/artist/sessions/${sessionId}`, producerId);

  async function sendRequest() {
    if (!canCancel || !online || submitting) return;
    setSubmitting(true);
    setError(null);
    operationKey.current ??= crypto.randomUUID();
    const result = await cancelSessionAction({
      id: sessionId,
      operationKey: operationKey.current,
    });
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    router.replace(detailHref);
    router.refresh();
  }

  return (
    <div className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] flex flex-col overflow-hidden bg-[rgb(var(--bg-background))]">
      <FunnelTopBar
        title={held ? "Withdraw request" : "Request cancellation"}
        sub={producerName}
        onBack={() => {
          router.push(detailHref);
        }}
      />
      <main className="sk-native-scroll mx-auto flex min-h-0 w-full max-w-[440px] flex-1 flex-col px-5 pt-12 pb-[max(env(safe-area-inset-bottom),24px)]">
        <div className="flex flex-1 flex-col items-center text-center">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background: "rgb(var(--fg-danger) / 0.10)",
              color: "rgb(var(--fg-danger))",
            }}
          >
            <CloseIcon width={28} height={28} />
          </span>
          <h1 className="font-display mt-6 text-[28px] leading-tight font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            {held ? "Withdraw this request?" : "Ask to cancel this session?"}
          </h1>
          <p className="mt-3 max-w-[330px] text-[14px] leading-relaxed text-[rgb(var(--fg-secondary))]">
            {canCancel
              ? held
                ? `This held time will be released now, and ${producerName} will be notified.`
                : `${producerName} will review your request. Your session stays booked, and no session credit changes until they approve it.`
              : "This session is outside the online change window. Contact your producer directly."}
          </p>
          {error ? (
            <p
              role="alert"
              className="mt-5 w-full rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] px-4 py-3 text-sm text-[rgb(var(--fg-danger-text))]"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-8 space-y-2.5">
          {canCancel ? (
            <button
              type="button"
              disabled={submitting || !online}
              onClick={() => {
                void sendRequest();
              }}
              className="sk-press w-full rounded-[var(--radius-lg)] px-5 py-4 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "rgb(var(--fg-danger))" }}
            >
              {submitting
                ? held
                  ? "Withdrawing…"
                  : "Sending request…"
                : online
                  ? held
                    ? "Withdraw request"
                    : "Send cancellation request"
                  : "Reconnect to send"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              router.push(detailHref);
            }}
            className="sk-press w-full rounded-[var(--radius-lg)] px-5 py-3.5 text-[14px] font-semibold text-[rgb(var(--fg-secondary))] disabled:opacity-60"
          >
            Keep my session
          </button>
        </div>
      </main>
    </div>
  );
}
