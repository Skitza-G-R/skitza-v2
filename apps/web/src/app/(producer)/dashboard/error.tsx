"use client";

import Link from "next/link";
import { useEffect } from "react";

import { NativeAction } from "~/components/native/native-actions";

export default function ProducerRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[producer-route]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[55dvh] w-full max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 text-center shadow-[var(--shadow-sm)] sm:p-8">
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
          Studio still open
        </p>
        <h1 className="font-display mt-3 text-2xl font-extrabold tracking-tight text-[rgb(var(--fg-default))]">
          This screen could not load
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
          Your navigation and current studio shell are still available. Try this screen again.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <NativeAction type="button" onClick={reset}>
            Try again
          </NativeAction>
          <Link
            href="/dashboard"
            className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 py-2.5 text-sm font-semibold text-[rgb(var(--fg-secondary))]"
          >
            Back to Today
          </Link>
        </div>
      </section>
    </main>
  );
}
