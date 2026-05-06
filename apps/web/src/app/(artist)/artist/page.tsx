import { auth, currentUser } from "@clerk/nextjs/server";

import { ActivityFeed } from "~/components/artist/home/activity-feed";
import { BalanceCard } from "~/components/artist/home/balance-card";
import { HomeHero } from "~/components/artist/home/home-hero";
import { LatestMixCard } from "~/components/artist/home/latest-mix-card";
import { NextSessionCard } from "~/components/artist/home/next-session-card";
import { UpcomingSessionsCard } from "~/components/artist/home/upcoming-sessions-card";
import { appRouter } from "~/server/trpc/routers/_app";
import { WelcomeModal } from "./welcome-modal";

// Server Component. Reads everything in one tRPC call (artist.home),
// then hands typed slices to the four child cards. The artist layout
// already gates non-signed-in traffic + redirects empty users to
// /artist-welcome, so by the time we get here we're guaranteed a
// userId AND ≥ 1 studio (or the user is also a producer).
//
// The `auth()` check is defense-in-depth: middleware → layout → page.
// All three would have to silently pass through an unauthenticated
// request for this to fall back to `null`.
export default async function ArtistHomePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [user, data] = await Promise.all([
    currentUser(),
    appRouter.createCaller({ userId }).artist.home(),
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
      <NextSessionCard session={data.nextSession} />
      <UpcomingSessionsCard sessions={data.upcomingSessions} />
      <LatestMixCard mix={data.latestMix} />
      <BalanceCard balance={data.outstandingBalance} />
      <ActivityFeed events={data.activity} />
    </div>
  );
}
