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
      <div className="reveal-up space-y-4">
        <header className="px-1">
          <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            Book
            <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
            Sessions live here once you're connected to a producer.
          </p>
        </header>
        <div className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]">
          No studios yet. Once a producer invites you, booking shows up
          here.
        </div>
      </div>
    );
  }

  const [availability, { products }, activePackages] = await Promise.all([
    caller.artist.book.availability({ producerId: activeStudioId }),
    caller.artist.store.products({ producerId: activeStudioId }),
    caller.artist.book.activePackages({ producerId: activeStudioId }),
  ]);

  return (
    <div className="reveal-up space-y-4">
      <header className="px-1">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]">
          Book
          <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
        </h1>
        <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
          {studios.length > 1
            ? "Pick a producer to see their availability."
            : "Pick a slot in the next 14 days."}
        </p>
      </header>
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
