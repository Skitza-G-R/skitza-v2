import { auth, currentUser } from "@clerk/nextjs/server";

import { BookSessionTiles } from "~/components/artist/home/book-session-tiles";
import { GreetingStrip } from "~/components/artist/home/greeting-strip";
import { LastUploadCard } from "~/components/artist/home/last-upload-card";
import { NextSessionCard } from "~/components/artist/home/next-session-card";
import { PaymentRequestsSection } from "~/components/artist/home/payment-requests-section";
import { appRouter } from "~/server/trpc/routers/_app";

import { WelcomeModal } from "./welcome-modal";

// /artist — high-fidelity redesign (SK-33).
//
// Single column, top to bottom:
//   1. GreetingStrip          — date eyebrow + greeting
//   2. LastUploadCard         — PRIMARY hero (170×170 art + big Play FAB)
//   3. NextSessionCard        — SECONDARY compact strip
//   4. PaymentRequestsSection — TERTIARY thin list (up to 3 rows)
//   5. BookSessionTiles       — QUATERNARY producer roster tiles
//
// All four sections handle their own empty states. PersistentPlayer
// is mounted by the artist app shell and stays where it is.
export default async function ArtistHomePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const [user, data, pendingPayments, studiosResp] = await Promise.all([
    currentUser(),
    caller.artist.home(),
    caller.artist.book.myPendingPayments(),
    caller.artist.studios(),
  ]);

  const firstName = user?.firstName?.trim() || "there";

  // Shape adapters: the router and the components were built in
  // separate tasks. The router doesn't (yet) carry durationMs on
  // latestMix; LastUploadCard needs it for the player's progress
  // estimate, so we pass null and let the player resolve from audio
  // metadata on play. studios() returns the canonical Studio shape
  // ({ producerId, name, slug, logoUrl }); BookSessionTiles only
  // needs three fields under different keys.
  const latestMixForCard = data.latestMix
    ? { ...data.latestMix, durationMs: null }
    : null;
  const studiosForTiles = studiosResp.studios.map((s) => ({
    producerId: s.producerId,
    producerName: s.name,
    producerSlug: s.slug,
  }));

  return (
    <>
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-7 py-6">
        <GreetingStrip firstName={firstName} />
        <LastUploadCard latestMix={latestMixForCard} />
        <NextSessionCard nextSession={data.nextSession} />
        <PaymentRequestsSection bookings={pendingPayments.bookings} />
        <BookSessionTiles studios={studiosForTiles} />
      </div>
      <WelcomeModal />
    </>
  );
}
