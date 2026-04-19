import { auth } from "@clerk/nextjs/server";

import { ActivityFeed } from "~/components/artist/home/activity-feed";
import { BalanceCard } from "~/components/artist/home/balance-card";
import { LatestMixCard } from "~/components/artist/home/latest-mix-card";
import { NextSessionCard } from "~/components/artist/home/next-session-card";
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

  const caller = appRouter.createCaller({ userId });
  const data = await caller.artist.home();

  return (
    <div className="space-y-4">
      <WelcomeModal />
      <h1 className="sr-only">Home</h1>
      <NextSessionCard session={data.nextSession} />
      <LatestMixCard mix={data.latestMix} />
      <BalanceCard balance={data.outstandingBalance} />
      <ActivityFeed events={data.activity} />
    </div>
  );
}
