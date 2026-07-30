import Link from "next/link";
import type { ReactNode } from "react";

import { ThemeToggle } from "~/components/shell/theme-toggle";

/**
 * Shared auth chrome.
 *
 * Each auth page marks its content with `data-auth-page`. The shell stays a
 * server component while CSS uses that marker to give sign-in and sign-up
 * intentionally different jobs:
 *
 * - sign-in: a quiet, focused app entrance on every viewport;
 * - sign-up: a compact phone header and a richer marketing/workflow panel on
 *   desktop.
 *
 * The public parent is intentionally dark for storefront pages. The
 * `.sk-auth-shell` token reset in globals.css lets auth follow next-themes'
 * saved/system choice without changing that public-route decision.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sk-auth-shell relative overflow-x-clip text-[rgb(var(--fg-primary))]">
      <div className="sk-auth-theme-control">
        <ThemeToggle />
      </div>

      <main id="main-content" tabIndex={-1} className="sk-auth-main focus:outline-none">
        <BrandPanel />
        <FormColumn>{children}</FormColumn>
      </main>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="sk-auth-brand-panel">
      <span aria-hidden className="sk-auth-brand-glow sk-auth-brand-glow-top" />
      <span aria-hidden className="sk-auth-brand-glow sk-auth-brand-glow-bottom" />

      <div className="sk-auth-brand-inner">
        <BrandLockup />

        <div className="sk-auth-marketing">
          <div className="mb-4 font-mono text-[11px] font-bold tracking-[0.2em] text-white/55 uppercase">
            One link. One workspace.
          </div>
          <h1 className="font-syne max-w-[520px] text-[44px] leading-[1.02] font-extrabold tracking-[-0.04em] text-balance text-white xl:text-[52px]">
            The business side of music, in rhythm.
          </h1>
          <p className="mt-5 max-w-[470px] text-[15px] leading-[1.6] text-white/70">
            Let artists book, keep every version in its place, and know when a payment
            clears—without stitching five tools together.
          </p>

          <WorkflowPreview />
        </div>

        <p className="sk-auth-trust-copy">
          Built for independent producers who want the business side to feel as considered as the
          music.
        </p>
      </div>
    </aside>
  );
}

function BrandLockup() {
  return (
    <>
      <Link
        href="/"
        className="sk-auth-wordmark sk-auth-browser-only sk-press"
        aria-label="Skitza marketing site"
      >
        <WordmarkContents />
      </Link>
      <div role="img" aria-label="Skitza" className="sk-auth-wordmark sk-auth-standalone-only">
        <WordmarkContents />
      </div>
    </>
  );
}

function WordmarkContents() {
  return (
    <>
      <span className="sk-auth-wordmark-mark" aria-hidden>
        S
      </span>
      <span className="font-syne text-[19px] font-extrabold tracking-[-0.04em]">skitza</span>
    </>
  );
}

function WorkflowPreview() {
  return (
    <div className="sk-auth-workflow" aria-label="A typical workflow in Skitza">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div>
          <div className="font-mono text-[9px] font-bold tracking-[0.18em] text-white/40 uppercase">
            Today in Skitza
          </div>
          <div className="mt-1 text-[13px] font-semibold text-white/90">Your work keeps moving</div>
        </div>
        <span className="rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary)/0.28)] bg-[rgb(var(--brand-primary)/0.12)] px-2 py-1 text-[10px] font-bold text-[rgb(var(--brand-primary))]">
          Live workspace
        </span>
      </div>

      <ol className="sk-auth-workflow-list">
        <WorkflowStep
          label="Session booked"
          detail="Mix session · Today at 14:00"
          status="Confirmed"
        />
        <WorkflowStep
          label="New mix uploaded"
          detail="Version 3 · Ready for notes"
          status="Shared"
        />
        <WorkflowStep
          label="Payment cleared"
          detail="The final delivery is unlocked"
          status="Paid"
        />
      </ol>
    </div>
  );
}

function WorkflowStep({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status: string;
}) {
  return (
    <li className="sk-auth-workflow-step">
      <span className="sk-auth-workflow-node" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-white/90">{label}</div>
        <div className="mt-0.5 truncate text-[11.5px] text-white/48">{detail}</div>
      </div>
      <span className="shrink-0 font-mono text-[9px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary))] uppercase">
        {status}
      </span>
    </li>
  );
}

function FormColumn({ children }: { children: ReactNode }) {
  return (
    <section className="sk-auth-form-column">
      <div className="sk-auth-form-stage">
        <div className="sk-auth-form w-full max-w-[420px]">{children}</div>
      </div>

      <footer className="sk-auth-footer font-mono text-[11px] tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
        <Link
          href="/"
          className="sk-auth-browser-only sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-1 hover:text-[rgb(var(--fg-primary))]"
        >
          ← Marketing site
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Link
            href="/terms"
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-2 hover:text-[rgb(var(--fg-primary))]"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-2 hover:text-[rgb(var(--fg-primary))]"
          >
            Privacy
          </Link>
          <Link
            href="/about"
            className="sk-auth-browser-only sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-2 hover:text-[rgb(var(--fg-primary))]"
          >
            About
          </Link>
        </div>
      </footer>
    </section>
  );
}
