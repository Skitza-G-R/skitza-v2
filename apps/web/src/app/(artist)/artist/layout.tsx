import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createDb, eq, producers, clientContacts } from "@skitza/db";
import { ArtistAppShell } from "~/components/artist/artist-app-shell";

// Server component. Runs on every /artist/* navigation. Decides:
// 1. Not signed in → /sign-in (handled by middleware, but defense-
//    in-depth here).
// 2. Signed in, no studios + not a producer → /artist-welcome.
// 3. Signed in, ≥1 studio OR also a producer → render <ArtistAppShell>
//    with the tab.
//
// /artist-welcome lives OUTSIDE this route group (under its own
// (artist-welcome) group) so the role-detection redirect can't
// infinite-loop, and so Welcome can opt out of the bottom nav +
// studio switcher chrome it doesn't need.
export default async function ArtistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/artist");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const db = createDb(dbUrl);

  // Role detection: count studios for this Clerk user.
  // If 0 AND the user is not also a producer → welcome screen.
  const [studioRow] = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(eq(clientContacts.clerkUserId, userId))
    .limit(1);

  const [producerRow] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);

  if (!studioRow && !producerRow) {
    redirect("/artist-welcome");
  }

  return <ArtistAppShell isProducer={!!producerRow}>{children}</ArtistAppShell>;
}
