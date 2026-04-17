import Link from "next/link";
import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";

// App shell used by /dashboard and its children.
// Header: Skitza wordmark + primary tabs + "View public" link + UserButton.
// Mobile: tabs wrap below the wordmark; UserButton stays right-aligned on both.
// Studio Monitor signature: a hairline glow under the header (like a
// rack-unit's power LED bar) in brand-primary.
//
// Slug lookup here is additive — the parent layout already runs the full
// gate check. We just need the slug string for the public-page shortcut,
// and Neon's pg driver is cheap enough for an extra SELECT on every app
// route (no N+1; one query per render, cached by React's request-scoped
// cache if the layout also queried it).
async function getProducerSlug(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ slug: producers.slug })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);
  return row?.slug ?? null;
}

export async function AppShell({
  active,
  children,
}: {
  active: "overview" | "portfolio" | "leads" | "booking" | "projects" | "settings";
  children: ReactNode;
}) {
  const slug = await getProducerSlug();
  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <header className="sticky top-0 z-20 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.78)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <WordmarkS />
            <span className="font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]">
              Skitza
            </span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            <ShellTab href="/dashboard" active={active === "overview"}>Overview</ShellTab>
            <ShellTab href="/dashboard/booking" active={active === "booking"}>Booking</ShellTab>
            <ShellTab href="/dashboard/projects" active={active === "projects"}>Projects</ShellTab>
            <ShellTab href="/dashboard/portfolio" active={active === "portfolio"}>Portfolio</ShellTab>
            <ShellTab href="/dashboard/leads" active={active === "leads"}>Lead Links</ShellTab>
            <ShellTab href="/dashboard/settings" active={active === "settings"}>Settings</ShellTab>
          </nav>
          <div className="flex items-center gap-3">
            {slug ? (
              <Link
                href={`/p/${slug}`}
                target="_blank"
                rel="noreferrer"
                className="hidden items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 py-1 font-mono text-xs text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--brand-primary)/0.5)] hover:text-[rgb(var(--brand-primary))] sm:inline-flex"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
                View public
              </Link>
            ) : null}
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8 ring-1 ring-[rgb(var(--border-subtle))]",
                },
              }}
            />
          </div>
        </div>
        {/* Mobile nav row under the wordmark. */}
        <nav aria-label="Primary" className="flex gap-1 overflow-x-auto border-t border-[rgb(var(--border-subtle))] px-4 py-2 md:hidden">
          <ShellTab href="/dashboard" active={active === "overview"}>Overview</ShellTab>
          <ShellTab href="/dashboard/portfolio" active={active === "portfolio"}>Portfolio</ShellTab>
          <ShellTab href="/dashboard/leads" active={active === "leads"}>Lead Links</ShellTab>
        </nav>
        {/* Signal-bar: a 1px gradient hairline evoking a VU meter. */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[rgb(var(--brand-primary)/0.45)] to-transparent" />
      </header>
      <main id="main-content">{children}</main>
    </div>
  );
}

function ShellTab({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex items-center rounded-[var(--radius-sm)] px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))]"
          : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-primary))]",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

// Wordmark — a tiny speaker/LED motif, hand-drawn in SVG.
function WordmarkS() {
  return (
    <svg
      aria-hidden
      width="28"
      height="28"
      viewBox="0 0 28 28"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="skitza-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--brand-primary))" />
          <stop offset="100%" stopColor="rgb(var(--brand-accent))" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="rgb(var(--bg-elevated))" stroke="rgb(var(--border-strong))" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="url(#skitza-mark)" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2" fill="url(#skitza-mark)" />
    </svg>
  );
}
