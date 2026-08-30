// Pure presentation model for the producer's private-offer list (SK-294).
// The list is a work queue first: offers still waiting on an artist rise to
// the top ordered by soonest expiry, while every terminal offer lives in a
// collapsed, paged History section.

export type PrivateOfferListEntry = Readonly<{
  status: "draft" | "sent" | "accepted" | "declined" | "expired" | "canceled";
  expiresAt: Date;
  createdAt: Date;
}>;

export const PRIVATE_OFFER_HISTORY_PAGE_SIZE = 8;

export function isOpenPrivateOfferStatus(status: PrivateOfferListEntry["status"]): boolean {
  return status === "draft" || status === "sent";
}

/**
 * Split offers into the work queue (drafts + waiting-for-artist, soonest
 * expiry first) and terminal history (newest first). Ties in the queue fall
 * back to newest-created first so identical expiries stay stable.
 */
export function partitionProducerPrivateOffers<Entry extends PrivateOfferListEntry>(
  offers: readonly Entry[],
): { open: Entry[]; history: Entry[] } {
  const open: Entry[] = [];
  const history: Entry[] = [];
  for (const offer of offers) {
    (isOpenPrivateOfferStatus(offer.status) ? open : history).push(offer);
  }
  open.sort(
    (left, right) =>
      left.expiresAt.getTime() - right.expiresAt.getTime() ||
      right.createdAt.getTime() - left.createdAt.getTime(),
  );
  history.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  return { open, history };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export type PrivateOfferExpiryUrgency =
  | Readonly<{ kind: "expired" }>
  | Readonly<{ kind: "days-left"; days: number; tone: "danger" | "warning" }>
  | Readonly<{ kind: "date" }>;

/**
 * How urgently a waiting offer needs a nudge. Whole days remaining, rounded
 * up: the last day is danger, up to three days is warning, further out the
 * row shows the plain expiry date.
 */
export function privateOfferExpiryUrgency(expiresAt: Date, now: Date): PrivateOfferExpiryUrgency {
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
  if (daysLeft <= 0) return { kind: "expired" };
  if (daysLeft <= 3) {
    return { kind: "days-left", days: daysLeft, tone: daysLeft <= 1 ? "danger" : "warning" };
  }
  return { kind: "date" };
}
