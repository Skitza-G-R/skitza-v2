import type { ReactNode } from "react";

import { JoinNav } from "~/components/join/join-nav";

export function JoinContinuationShell({ children }: { children: ReactNode }) {
  return (
    <div className="sk-auth-shell relative flex min-h-dvh flex-col overflow-x-clip text-[rgb(var(--fg-primary))]">
      <JoinNav />
      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex flex-1 items-start justify-center px-4 py-6 focus:outline-none sm:px-6 sm:py-10 lg:items-center lg:py-12"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgb(var(--brand-primary)/0.09),transparent_29rem)]"
        />
        <section className="relative w-full max-w-[440px] overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-[var(--shadow-lg)] sm:p-8">
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[rgb(var(--brand-primary))] via-[rgb(var(--brand-primary-dark))] to-[rgb(var(--brand-accent))]"
          />
          {children}
        </section>
      </main>
    </div>
  );
}
