import { currentUser } from "@clerk/nextjs/server";
import { auth } from "~/server/auth/clerk-identity";

import {
  selectArtistHomeMainAction,
  type ArtistHomeAction,
  withoutArtistHomeDuplicate,
} from "~/components/artist/home/home-priority";
import { artistHomeBookingStatusActions } from "~/components/artist/home/booking-status";
import { artistGreeting } from "~/components/artist/home/home-timezone";
import { ProfessionalArtistHome } from "~/components/artist/home/professional-home";
import { RuntimeScreenSafeViewWriter } from "~/components/runtime-state/runtime-screen-view";
import { resolveArtistStudioId, withArtistStudio } from "~/lib/artist-studio-context";
import { formatPurchaseMoney } from "~/components/artist/purchase/purchase-data";
import { mapArtistHomeSafeScreen } from "~/lib/runtime-state/screen-view-mappers";
import { readArtistStudioPreference } from "~/server/artist/studio-preference";
import { appRouter } from "~/server/trpc/routers/_app";

type ArtistHomePageProps = {
  searchParams?: Promise<{ studio?: string }>;
};

export default async function ArtistHomePage({ searchParams }: ArtistHomePageProps) {
  const { userId, providerUserId } = await auth();
  if (!userId || !providerUserId) return null;

  const caller = appRouter.createCaller({ userId });
  const [user, studiosResponse, savedStudioId, artistProfile] = await Promise.all([
    currentUser(),
    caller.artist.studios(),
    readArtistStudioPreference(providerUserId),
    caller.artistPlatform.profile.get(),
  ]);
  const requestedStudioId = (await searchParams)?.studio;
  const activeStudioId = resolveArtistStudioId(
    studiosResponse.studios,
    requestedStudioId,
    savedStudioId,
  );
  const firstName = user?.firstName?.trim() || "there";
  const artistTimezone = artistProfile.timezone ?? "UTC";
  const greeting = artistGreeting(new Date(), firstName, artistTimezone);
  const activeStudio = studiosResponse.studios.find(
    (studio) => studio.producerId === activeStudioId,
  );

  if (!activeStudio) {
    return (
      <div className="mx-auto w-full max-w-[820px] px-4 py-5 sm:px-6 sm:py-7">
        <h1 className="font-display text-[25px] font-bold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
          {greeting}
        </h1>
        <section className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
          <h2 className="font-display text-[21px] font-bold text-[rgb(var(--fg-default))]">
            No active studio
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
            Connected studios and preserved studio history appear in Settings.
          </p>
          <a
            href="/artist/settings"
            className="sk-press mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 py-2.5 text-[13px] font-bold text-[rgb(var(--fg-onsidebar))]"
          >
            Open Settings
          </a>
        </section>
      </div>
    );
  }

  const [home, paymentReadModel, sessions, currentRequest] = await Promise.all([
    caller.artist.home({ producerId: activeStudio.producerId }),
    caller.artist.purchase.payments(),
    caller.artist.book.mySessions({ producerId: activeStudio.producerId }),
    caller.artist.purchase.current({ producerId: activeStudio.producerId }),
  ]);

  const candidates: ArtistHomeAction[] = [];
  const now = new Date();
  const bookingStatusActions = artistHomeBookingStatusActions({
    sessions: sessions.sessions,
    producerId: activeStudio.producerId,
    artistTimezone,
    now,
  });
  candidates.push(...bookingStatusActions.filter(({ mainEligible }) => mainEligible));

  const selectedPayments = [
    ...paymentReadModel.artistBuckets.waiting.projects,
    ...paymentReadModel.artistBuckets.active.projects,
  ]
    .filter((project) => project.producerId === activeStudio.producerId)
    .flatMap((project) =>
      project.purchases.map((purchase) => ({ purchase, projectTitle: project.title })),
    );
  for (const { purchase, projectTitle } of selectedPayments) {
    if (!purchase.showPayNextPayment || !purchase.nextPayment) continue;
    candidates.push({
      id: purchase.id,
      kind: "payment_action",
      title: `${formatPurchaseMoney(purchase.nextPayment.amountCents, purchase.currency)} due`,
      detail: `${purchase.commercialSnapshot.productOrOfferName || projectTitle} · ${installmentLabel(
        purchase.nextPayment.position,
        purchase.installments.length,
      )}`,
      href: withArtistStudio(`/artist/payments/${purchase.id}`, activeStudio.producerId),
      actionLabel: "View payment",
      upcomingAt: purchase.nextPayment.dueAt,
      occurredAt: purchase.commercialEstablishedAt,
    });
  }

  const currentPurchaseRequest = currentRequest.current;
  let approvedRequestAction: ArtistHomeAction | null = null;
  if (currentPurchaseRequest?.status === "approved" && currentPurchaseRequest.productId) {
    approvedRequestAction = {
      id: currentPurchaseRequest.id,
      kind: "payment_action",
      title: `${currentPurchaseRequest.productNameSnapshot} was approved`,
      detail: currentPurchaseRequest.acceptanceAvailable
        ? `Choose a payment plan and review the agreement with ${activeStudio.name}.`
        : `${activeStudio.name} approved your request, but this offer is temporarily unavailable.`,
      href: currentPurchaseRequest.acceptanceAvailable
        ? withArtistStudio(
            `/artist/purchase/${currentPurchaseRequest.productId}/pay?req=${currentPurchaseRequest.id}`,
            activeStudio.producerId,
          )
        : withArtistStudio("/artist/store", activeStudio.producerId),
      actionLabel: currentPurchaseRequest.acceptanceAvailable
        ? "Choose a payment plan"
        : "View services",
      upcomingAt: null,
      occurredAt: currentPurchaseRequest.statusChangedAt ?? currentPurchaseRequest.createdAt,
    };
    candidates.push(approvedRequestAction);
  }

  const selectedAllowances = sessions.allowances.filter(
    (allowance) => allowance.producerId === activeStudio.producerId && allowance.canBook,
  );
  for (const allowance of selectedAllowances) {
    candidates.push({
      id: allowance.sessionAllowanceId,
      kind: "ready_to_schedule",
      title: allowance.packageName,
      detail:
        allowance.sessionsRemaining === null
          ? `${String(allowance.durationMin)} min · sessions available`
          : `${String(allowance.sessionsRemaining)} ${
              allowance.sessionsRemaining === 1 ? "session" : "sessions"
            } left`,
      href: withArtistStudio(
        `/artist/book?allowance=${allowance.sessionAllowanceId}`,
        activeStudio.producerId,
      ),
      actionLabel: `Book with ${activeStudio.name}`,
      upcomingAt: null,
      occurredAt: now,
    });
  }

  let newSongAction: ArtistHomeAction | null = null;
  if (home.latestMix?.unread) {
    newSongAction = {
      id: home.latestMix.id,
      kind: "new_song",
      title: home.latestMix.trackTitle,
      detail: `${home.latestMix.label} · ${activeStudio.name}`,
      href: withArtistStudio(`/artist/music/song/${home.latestMix.id}`, activeStudio.producerId),
      actionLabel: "Open song",
      upcomingAt: null,
      occurredAt: home.latestMix.uploadedAt,
      isNew: true,
      audio: {
        url: home.latestMix.audioUrl,
        title: home.latestMix.trackTitle,
        subtitle: activeStudio.name,
        durationMs: null,
      },
    };
    candidates.push(newSongAction);
  }

  const serviceAction: ArtistHomeAction = {
    id: `services:${activeStudio.producerId}`,
    kind: "services",
    title: `Work with ${activeStudio.name}`,
    detail: "Browse the studio’s available services and send a request.",
    href: withArtistStudio("/artist/store", activeStudio.producerId),
    actionLabel: "View services",
    upcomingAt: null,
    occurredAt: new Date(0),
  };
  candidates.push(serviceAction);

  const main = selectArtistHomeMainAction(candidates) ?? serviceAction;
  const supporting: ArtistHomeAction[] = [
    ...(approvedRequestAction ? [approvedRequestAction] : []),
    ...bookingStatusActions,
  ];

  if (currentPurchaseRequest?.status === "pending") {
    supporting.push({
      id: currentPurchaseRequest.id,
      kind: "payment_action",
      title: `${currentPurchaseRequest.productNameSnapshot} is under review`,
      detail: `${activeStudio.name} will respond to your request.`,
      href: withArtistStudio(
        `/artist/purchase/${currentPurchaseRequest.productId ?? currentPurchaseRequest.id}/sent?req=${currentPurchaseRequest.id}`,
        activeStudio.producerId,
      ),
      actionLabel: "View",
      upcomingAt: null,
      occurredAt: currentPurchaseRequest.createdAt,
    });
  }
  const proofUnderReview = selectedPayments.find(
    ({ purchase }) => purchase.producerBucket === "needs_review",
  );
  if (proofUnderReview) {
    supporting.push({
      id: proofUnderReview.purchase.id,
      kind: "payment_action",
      title: "Proof awaiting studio review",
      detail: proofUnderReview.purchase.commercialSnapshot.productOrOfferName,
      href: withArtistStudio(
        `/artist/payments/${proofUnderReview.purchase.id}`,
        activeStudio.producerId,
      ),
      actionLabel: "View",
      upcomingAt: null,
      occurredAt: proofUnderReview.purchase.commercialEstablishedAt,
    });
  }
  const meaningfulItems =
    bookingStatusActions.length > 0 ||
    selectedPayments.length > 0 ||
    selectedAllowances.length > 0 ||
    home.latestMix !== null ||
    currentPurchaseRequest !== null;
  const quietRows = withoutArtistHomeDuplicate(supporting, main).slice(0, 3);

  return (
    <>
      <RuntimeScreenSafeViewWriter
        href={withArtistStudio("/artist", activeStudio.producerId)}
        contextId={activeStudio.producerId}
        view={mapArtistHomeSafeScreen({
          firstName,
          studios: [
            {
              producerId: activeStudio.producerId,
              producerName: activeStudio.name,
            },
          ],
          latestMix: home.latestMix,
        })}
      />
      <ProfessionalArtistHome
        greeting={greeting}
        studioName={activeStudio.name}
        main={main}
        newSong={main.kind === "new_song" ? null : newSongAction}
        supporting={quietRows}
        welcome={!meaningfulItems}
      />
    </>
  );
}

function installmentLabel(position: number, total: number): string {
  if (position === 1) return total > 1 ? "First payment" : "Payment";
  if (position === total) return "Remaining balance";
  return `Payment ${String(position)} of ${String(total)}`;
}
