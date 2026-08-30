import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";

/**
 * Builds the normal client invite URL for the verified artist signup flow.
 *
 * The URL identifies only the producer. Client and offer identifiers never
 * belong here: account verification connects the invited email to the
 * producer's client record after signup.
 */
export function buildClientInviteUrl(
  producerSlug: string,
  origin: string = PUBLIC_BRAND_ORIGIN,
): string {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/sign-up/join/${encodeURIComponent(producerSlug)}/home`;
}

/**
 * Builds the shareable link for one private offer — the same route the
 * notification email uses. The route already resolves every visitor state:
 * a new client signs up under this producer and lands on the offer, an
 * existing client signs in (or passes straight through) into their account.
 * The offer itself still opens only for the invited verified email.
 */
export function buildPrivateOfferInviteUrl(
  producerSlug: string,
  offerId: string,
  origin: string = PUBLIC_BRAND_ORIGIN,
): string {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/sign-up/join/${encodeURIComponent(producerSlug)}/offer/${encodeURIComponent(offerId)}`;
}
