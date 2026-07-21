"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { disconnectProducerAction } from "~/app/(artist)/artist/settings/actions";

// Small client component for the row-level "Disconnect" affordance on
// Settings → Connected producers. Uses a native `confirm()` so we
// don't ship a custom dialog component just for this — the action
// surface is destructive but unambiguous: one click → confirm →
// archived. After success, `router.refresh()` re-fetches the server
// component data on the same page so the disconnected row drops out
// without a full reload.
export function DisconnectProducerButton({
  producerId,
  producerName,
}: {
  producerId: string;
  producerName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    const message = `Disconnect from ${producerName}? You will lose access to all music and history with this studio.`;
    if (!window.confirm(message)) return;

    setError(null);
    startTransition(async () => {
      const result = await disconnectProducerAction({ producerId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`Disconnect from ${producerName}`}
        onClick={onClick}
        disabled={pending}
        className="sk-press min-h-11 rounded-[var(--radius-lg)] px-3 py-1.5 text-[11px] font-semibold text-[rgb(var(--fg-danger))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.1)] disabled:opacity-50"
      >
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {error ? (
        <p
          role="alert"
          className="max-w-[180px] text-right text-[10.5px] text-[rgb(var(--fg-danger))]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
