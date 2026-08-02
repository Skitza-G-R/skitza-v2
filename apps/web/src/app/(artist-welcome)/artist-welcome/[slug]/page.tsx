import { redirect } from "next/navigation";

import { joinContinuationHref } from "~/server/auth/post-sign-in";

// Retired legacy splash. Connection writes now happen only through the
// explicit Book POST or the signed, short-lived post-auth resume POST. Keeping
// this route as a read-only redirect preserves old links without restoring the
// former authenticated-GET mutation or its self-join hole.
export default async function JoinedArtistWelcomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(joinContinuationHref(slug));
}
