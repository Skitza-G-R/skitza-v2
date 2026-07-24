"use client";

import Link from "next/link";

import { NativeAction } from "~/components/native/native-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";

export default function ArtistError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const online = useOnlineStatus();

  return (
    <section
      role="alert"
      aria-labelledby="artist-error-title"
      className="mx-auto max-w-lg rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-7 text-center shadow-[var(--shadow-sm)]"
    >
      <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-text))] uppercase">
        {online ? "Screen unavailable" : "You’re offline"}
      </p>
      <h1
        id="artist-error-title"
        className="font-display mt-2 text-2xl font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
      >
        {online ? "This screen didn’t load." : "Reconnect to load this screen."}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
        Your artist shell and current audio stay available. No booking or payment action was
        confirmed.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <NativeAction type="button" onClick={reset} disabled={!online}>
          {online ? "Try again" : "Waiting for connection"}
        </NativeAction>
        <Link
          href="/artist"
          className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 py-2.5 text-sm font-semibold text-[rgb(var(--fg-secondary))]"
        >
          Artist home
        </Link>
      </div>
    </section>
  );
}
