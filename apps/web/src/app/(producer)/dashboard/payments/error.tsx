"use client";

export default function PaymentsError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-16 text-center sm:px-6">
      <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
        Payments could not load
      </h1>
      <p className="mx-auto mt-2 max-w-[44ch] text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
        The ledger is unavailable right now. No balances have been replaced with zero.
      </p>
      <button
        type="button"
        onClick={reset}
        className="sk-press mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-sm font-bold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
      >
        Try again
      </button>
    </main>
  );
}
