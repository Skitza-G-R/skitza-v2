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

// The purchase-status "heartbeat" card (S6): surface the latest real request
// for each connected studio, including payment progress from Gate 2.
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
        const { current } = await caller.artist.purchase.current({
          producerId: studio.producerId,
        });
        return current ? { current, studio } : null;
      }),
    );
    const open = hits
      .filter((h) => h !== null)
      .sort((a, b) => b.current.createdAt.getTime() - a.current.createdAt.getTime())[0];
    if (!open) return null;
    const { current, studio } = open;
    // A deleted product nulls productId, but the locked request must remain
    // payable. The pay routes use `req` as ownership/source of truth, so the
    // request id is a safe canonical URL placeholder in that legacy case.
    const paymentRouteProductId = current.productId ?? current.id;

    // BE-2 status → heartbeat stage (handoff S6's five states).
    const stage =
      current.status === "pending"
        ? ("pending_review" as const)
        : current.status === "approved"
          ? ("awaiting_payment" as const)
          : current.status === "verifying"
            ? ("verifying" as const)
            : current.status === "paid"
              ? ("paid" as const)
              : ("declined" as const);

    // Context CTA: approved → choose the plan. A confirmed deposit opens
    // sessions, but a remaining balance keeps the next-payment route handy.
    const action =
      stage === "awaiting_payment"
        ? {
            actionHref: `/artist/purchase/${paymentRouteProductId}/pay?req=${current.id}`,
            actionLabel: "Choose a payment plan",
          }
        : stage === "paid" && current.remainingCents > 0
          ? {
              actionHref: `/artist/purchase/${paymentRouteProductId}/pay/instructions?req=${current.id}`,
              actionLabel: "Make next payment",
            }
          : stage === "paid"
            ? { actionHref: "/artist/book", actionLabel: "Book a session" }
            : {};

    return {
      stage,
      productName: current.productNameSnapshot,
      priceCents: current.priceCents,
      remainingCents: current.remainingCents,
      producerName: studio.name,
      ...action,
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
  const [user, data, pendingPayments, studiosResp, pendingPurchase] = await Promise.all([
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
  const latestMixForCard = data.latestMix ? { ...data.latestMix, durationMs: null } : null;
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
