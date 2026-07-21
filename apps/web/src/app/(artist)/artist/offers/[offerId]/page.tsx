import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrivateOfferResponse } from "~/components/artist/offers/private-offer-response";
import { PrivateOfferTerms } from "~/components/artist/offers/private-offer-terms";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ offerId: string }> };

export default async function PrivateOfferPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { offerId } = await params;
  const caller = appRouter.createCaller({ userId });

  let offer;
  try {
    offer = await caller.privateOffers.artistGet({ offerId });
  } catch {
    // Missing, expired, canceled, rejected, accepted, and foreign-tenant
    // offers deliberately share one non-leaking outcome.
    notFound();
  }

  const targetLabel = offer.targetProjectId
    ? (offer.targetProjectTitle ?? "Existing project")
    : "Start a new project";

  return (
    <main className="mx-auto w-full max-w-[760px] space-y-5 px-4 py-6 sm:px-7">
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={withArtistStudio("/artist/store", offer.producerId)}
            className="text-xs font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
          >
            ← Store
          </Link>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            From {offer.producerName?.trim() || "your producer"}
          </p>
        </div>
        <time
          dateTime={offer.expiresAt.toISOString()}
          className="shrink-0 text-right font-mono text-[10px] tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase"
        >
          Expires
          <br />
          {offer.expiresAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}
        </time>
      </header>

      <PrivateOfferTerms snapshot={offer.commercialDraft} targetLabel={targetLabel} />
      <PrivateOfferResponse
        offerId={offer.id}
        studioId={offer.producerId}
        updatedAt={offer.updatedAt}
        targetProjectTitle={offer.targetProjectTitle ?? null}
        snapshot={offer.commercialDraft}
      />
    </main>
  );
}
