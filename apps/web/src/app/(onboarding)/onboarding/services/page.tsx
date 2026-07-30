import { redirect } from "next/navigation";

import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";

/**
 * The old role-chip screen is no longer part of producer onboarding.
 * Keep the URL as a compatibility redirect so bookmarks cannot reopen a
 * competing flow.
 */
export default async function LegacyServicesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(`/onboarding/service${isDevPreviewBypass(params) ? "?__preview=1" : ""}`);
}
