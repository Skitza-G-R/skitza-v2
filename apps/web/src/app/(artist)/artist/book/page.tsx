import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";
import { BookingClient } from "./booking-client";

type PageProps = { searchParams: Promise<{ studio?: string }> };

// Server Component. Resolves the artist's studios + the active
// studio's 14-day availability up front so the client component
// paints immediately. The active studio is selected via ?studio=<id>
// from the Studio Switcher; falling back to the first studio when
// nothing is specified.
//
// The artist layout already gates on sign-in + redirects empty users
// to /artist-welcome, so the auth() check here is defense-in-depth
// (matches the other tab pages).
export default async function BookPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });

  const sp = await searchParams;
  const { studios } = await caller.artist.studios();

  // Default to the studio from the search param, or the most-recent
  // studio. `studios` is already sorted desc by lastSeenAt server-side.
  const activeStudioId = sp.studio ?? studios[0]?.producerId;
  if (!activeStudioId) {
    return (
      <div className="reveal-up space-y-5">
        <BookEyebrow />
        <EmptyStudios />
      </div>
    );
  }

  const [availability, { products }, activePackages] = await Promise.all([
    caller.artist.book.availability({ producerId: activeStudioId }),
    caller.artist.store.products({ producerId: activeStudioId }),
    caller.artist.book.activePackages({ producerId: activeStudioId }),
  ]);

  return (
    <div className="reveal-up mx-auto w-full max-w-5xl space-y-5">
      <BookEyebrow />
      <BookingClient
        activeStudioId={activeStudioId}
        availability={availability}
        products={products}
        studios={studios}
        activePackages={activePackages}
      />
    </div>
  );
}

// Tiny page-identity row above the card. The card itself carries the
// producer + session context, so this stays a quiet visual handle for
// the route rather than a competing heading.
function BookEyebrow() {
  return (
    <header className="flex items-baseline justify-between px-1 sm:px-0">
      <h1 className="font-display text-[20px] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--fg-default))]">
        Book
        <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Next 14 days
      </p>
    </header>
  );
}

function EmptyStudios() {
  return (
    <section
      aria-label="No studios yet"
      className="overflow-hidden rounded-[var(--radius-2xl)] border bg-[rgb(var(--bg-elevated))]"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div
        aria-hidden
        className="flex h-28 items-center justify-center"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgb(var(--brand-primary) / 0.18), transparent 65%), rgb(var(--bg-overlay))",
        }}
      >
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-[0.24em]"
          style={{ color: "rgb(var(--brand-primary))" }}
        >
          Waiting for an invite
        </span>
      </div>
      <div className="px-6 py-6 lg:px-8">
        <p className="font-display text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          Nothing to book yet.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Once a producer invites you, their next 14 days appear here. You
          pick a window, they confirm.
        </p>
      </div>
    </section>
  );
}
