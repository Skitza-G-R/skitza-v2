import { auth, currentUser } from "@clerk/nextjs/server";

import { BookSessionTiles } from "~/components/artist/home/book-session-tiles";
import { GreetingStrip } from "~/components/artist/home/greeting-strip";
import { LastUploadCard } from "~/components/artist/home/last-upload-card";
import { NextSessionCard } from "~/components/artist/home/next-session-card";
import { PaymentRequestsSection } from "~/components/artist/home/payment-requests-section";
import { PurchaseStatusCard } from "~/components/artist/home/purchase-status-card";
import { appRouter } from "~/server/trpc/routers/_app";

import { WelcomeModal } from "./welcome-modal";

type Caller = ReturnType<typeof appRouter.createCaller>;

// The purchase-status "heartbeat" card (S6): surface the artist's open
// purchase request, if any. Same source of truth as the purchase entry
// page (`artist.purchase.pending` per studio, then `get` for the
// price-locked snapshot). `pending` only returns Gate-1 rows
// (status="pending"), so the only stage reachable here today is
// "pending_review" — approved/declined requests aren't discoverable
// from the home page yet.
// BE-2 (SK-38): wire awaiting-payment/verifying stages once the artist
// can see payment state on approved requests.
async function loadPendingPurchase(
  caller: Caller,
  studios: Array<{ producerId: string; name: string }>,
) {
  // Fail soft: this card is an enhancement, not the page's critical
  // path. If the probe throws (e.g. an environment whose DB hasn't run
  // the purchase_requests migration yet — this took down /artist on the
  // SK-50 preview), log it and render the home without the card.
  try {
    const hits = await Promise.all(
      studios.map(async (studio) => {
        const { pending } = await caller.artist.purchase.pending({
          producerId: studio.producerId,
        });
        return pending ? { pending, studio } : null;
      }),
    );
    const open = hits
      .filter((h) => h !== null)
      .sort(
        (a, b) =>
          b.pending.createdAt.getTime() - a.pending.createdAt.getTime(),
      )[0];
    if (!open) return null;

    const request = await caller.artist.purchase.get({
      purchaseRequestId: open.pending.id,
    });
    // If the status flipped between the two reads (approve/decline race),
    // skip the card rather than render a stale stage.
    if (request.status !== "pending") return null;

    return {
      stage: "pending_review" as const,
      productName: request.productNameSnapshot,
      priceCents: request.priceCents,
      producerName: open.studio.name,
    };
  } catch (err) {
    console.error("[artist-home] pending-purchase probe failed", err);
    return null;
  }
}

// /artist — high-fidelity redesign (SK-33).
//
// Single column, top to bottom:
//   1. GreetingStrip          — date eyebrow + greeting
//   2. PurchaseStatusCard     — heartbeat card (only with an open request)
//   3. LastUploadCard         — PRIMARY hero (170×170 art + big Play FAB)
//   4. NextSessionCard        — SECONDARY compact strip
//   5. PaymentRequestsSection — TERTIARY thin list (up to 3 rows)
//   6. BookSessionTiles       — QUATERNARY producer roster tiles
//
// All four sections handle their own empty states. PersistentPlayer
// is mounted by the artist app shell and stays where it is.
export default async function ArtistHomePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const studiosPromise = caller.artist.studios();
  const [user, data, pendingPayments, studiosResp, pendingPurchase] =
    await Promise.all([
      currentUser(),
      caller.artist.home(),
      caller.artist.book.myPendingPayments(),
      studiosPromise,
      studiosPromise.then((resp) => loadPendingPurchase(caller, resp.studios)),
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
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-7 py-6">
        <GreetingStrip firstName={firstName} />
        {pendingPurchase ? <PurchaseStatusCard {...pendingPurchase} /> : null}
        <LastUploadCard latestMix={latestMixForCard} />
        <NextSessionCard nextSession={data.nextSession} />
        <PaymentRequestsSection bookings={pendingPayments.bookings} />
        <BookSessionTiles studios={studiosForTiles} />
      </div>
      <WelcomeModal />
    </>
  );
}
