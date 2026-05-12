import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

import { ActivityFeed } from "~/components/artist/home/activity-feed";
import { BalanceCard } from "~/components/artist/home/balance-card";
import { HomeHero } from "~/components/artist/home/home-hero";
import { LatestMixCard } from "~/components/artist/home/latest-mix-card";
import { NextSessionCard } from "~/components/artist/home/next-session-card";
import { UpcomingSessionsCard } from "~/components/artist/home/upcoming-sessions-card";
import { appRouter } from "~/server/trpc/routers/_app";
import { WelcomeModal } from "./welcome-modal";

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function formatAmount(amountCents: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  return `${symbol}${(amountCents / 100).toFixed(2)}`;
}

// Server Component. Reads everything in one tRPC call (artist.home),
// then hands typed slices to the four child cards. The artist layout
// already gates non-signed-in traffic + redirects empty users to
// /artist-welcome, so by the time we get here we're guaranteed a
// userId AND ≥ 1 studio (or the user is also a producer).
//
// The `auth()` check is defense-in-depth: middleware → layout → page.
// All three would have to silently pass through an unauthenticated
// request for this to fall back to `null`.
//
// `?payment=success` lands here after Tranzila redirects through
// /artist/payment/success — the success banner renders inline below
// the hero. The booking itself is confirmed server-to-server via the
// notify_url POST, so the banner is purely a UX acknowledgement.
export default async function ArtistHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ payment?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;

  const resolvedSearchParams = (await searchParams) ?? {};

  const caller = appRouter.createCaller({ userId });
  const [user, data, pendingPayments] = await Promise.all([
    currentUser(),
    caller.artist.home(),
    caller.artist.book.myPendingPayments(),
  ]);

  // Hero copy. firstName falls back to "there" so a user without a
  // first-name set in Clerk still gets a friendly heading.
  const firstName = user?.firstName?.trim() || "there";
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  // One-line status: each upstream signal contributes a short bit.
  // Empty-state copy stays gentle — silence isn't bad news.
  const bits: string[] = [];
  if (data.latestMix) bits.push("new mix to review");
  if (data.nextSession) bits.push("session this week");
  if (
    data.outstandingBalance &&
    data.outstandingBalance.totalCents > 0
  ) {
    bits.push("balance pending");
  }
  const statusLine = bits.length > 0 ? bits.join(" · ") : "All quiet.";

  return (
    <div className="space-y-4">
      <WelcomeModal />
      <HomeHero
        firstName={firstName}
        todayLabel={todayLabel}
        statusLine={statusLine}
      />
      <Link
        href="/artist/book"
        className="sk-press flex w-full items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-6 py-3.5 font-syne font-bold text-black transition-opacity hover:opacity-90"
      >
        + Book a session
      </Link>
      {resolvedSearchParams.payment === "success" ? (
        <div className="rounded-[var(--radius-md)] border border-[rgb(var(--success)/0.4)] bg-[rgb(var(--success)/0.06)] p-4 mb-4">
          <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
            🎉 Payment confirmed — your session is booked!
          </p>
          <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
            Your producer will be in touch soon.
          </p>
        </div>
      ) : null}
      {pendingPayments.bookings.length > 0 ? (
        <div className="space-y-2">
          {pendingPayments.bookings.map((booking) => (
            <Link key={booking.id} href={`/artist/payment/${booking.id}`}>
              <div className="rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--brand-primary)/0.06)] p-4">
                <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
                  Session approved — payment required
                </p>
                <p className="mt-0.5 text-xs text-[rgb(var(--fg-muted))]">
                  {booking.producerName} · {booking.packageName} ·{" "}
                  {formatAmount(booking.amountCents, booking.currency)}
                </p>
                <p className="mt-2 text-xs font-medium text-[rgb(var(--brand-primary))]">
                  Complete payment →
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      <NextSessionCard session={data.nextSession} />
      <UpcomingSessionsCard sessions={data.upcomingSessions} />
      <LatestMixCard mix={data.latestMix} />
      <BalanceCard balance={data.outstandingBalance} />
      <ActivityFeed events={data.activity} />
    </div>
  );
}
