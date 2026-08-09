"use client";

import { useRouter } from "next/navigation";

export function ProjectsListFailure() {
  const router = useRouter();

  return (
    <main className="mx-auto flex min-h-[55dvh] w-full max-w-2xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 text-center shadow-[var(--shadow-sm)] sm:p-8">
        <h1 className="font-syne text-2xl font-extrabold tracking-tight text-[rgb(var(--fg-default))]">
          Couldn&apos;t load projects
        </h1>
        <button
          type="button"
          onClick={() => {
            router.refresh();
          }}
          className="sk-press mt-6 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-background))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          Retry
        </button>
      </section>
    </main>
  );
}
