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
  return `${normalizedOrigin}/sign-up/join/${encodeURIComponent(producerSlug)}`;
}
