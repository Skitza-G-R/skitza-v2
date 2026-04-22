import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createDb, eq, producers, clientContacts } from "@skitza/db";
import { ArtistAppShell } from "~/components/artist/artist-app-shell";
import { AppI18nProvider } from "~/i18n/app-i18n-provider";
import { appRouter } from "~/server/trpc/routers/_app";
import { joinArtistWorkspace } from "~/app/(artist-welcome)/artist-welcome/[slug]/actions";

// Server component. Runs on every /artist/* navigation. Decides:
// 1. Not signed in → /sign-in (handled by middleware, but defense-
//    in-depth here).
// 2. Signed in, no studios + not a producer → attempt self-healing
//    via the user's Clerk unsafeMetadata (set at /sign-up/join/<slug>
//    signup time). If metadata says they came via /join, invoke the
//    same upsert the welcome-slug page runs. Only if self-healing
//    fails do we fall through to /artist-welcome.
// 3. Signed in, ≥1 studio OR also a producer → render <ArtistAppShell>
//    with the tab.
//
// /artist-welcome lives OUTSIDE this route group (under its own
// (artist-welcome) group) so the role-detection redirect can't
// infinite-loop, and so Welcome can opt out of the bottom nav +
// studio switcher chrome it doesn't need.
//
// 2026-04-22 — Added the self-healing branch (step 2) after Gili
// reported getting stuck on /artist-welcome repeatedly despite the
// webhook-race + role-guard fixes. Even if Clerk's fallbackRedirectUrl
// somehow skips the slug welcome page, the layout now catches users
// arriving at /artist without a studio row but WITH join metadata,
// runs the upsert inline, and continues to render the app.
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
  // If 0 AND the user is not also a producer → try to self-heal via
  // unsafe_metadata first, then fall through to /artist-welcome.
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

  console.log("[/artist layout] role check:", {
    userId,
    hasStudio: !!studioRow,
    hasProducer: !!producerRow,
  });

  if (!studioRow && !producerRow) {
    // Self-heal: if the Clerk user's unsafeMetadata indicates they
    // signed up via /join/<slug>, invoke the same upsert the welcome
    // slug page runs. joinArtistWorkspace() internally redirects —
    // in the success case to /artist (we'll re-enter this layout
    // with a studio row present). If the slug is invalid it falls
    // through to /artist-welcome (no slug) where the role-guard's
    // recovery path will show the orphan copy.
    const user = await currentUser();
    const meta = user?.unsafeMetadata as
      | { signupOrigin?: unknown; producerSlug?: unknown }
      | undefined
      | null;
    const signupOrigin = meta?.signupOrigin;
    const producerSlug = meta?.producerSlug;
    console.log("[/artist layout] self-heal metadata check:", {
      signupOrigin,
      producerSlug,
    });
    if (signupOrigin === "join" && typeof producerSlug === "string") {
      console.log(
        "[/artist layout] self-healing via joinArtistWorkspace",
        { producerSlug },
      );
      // joinArtistWorkspace throws NEXT_REDIRECT internally. The
      // outer Next.js runtime catches + performs the redirect.
      await joinArtistWorkspace(producerSlug);
    }
    // No metadata available OR self-heal didn't redirect — fall
    // through to the generic welcome (which has its own recovery
    // branch + orphan copy).
    console.log(
      "[/artist layout] no studio + no producer + no metadata → /artist-welcome",
    );
    redirect("/artist-welcome");
  }

  // Preload the studio list so the Studio Switcher renders immediately
  // on every /artist/* navigation instead of suspending. The tRPC
  // procedure is the single source of truth for the dedup + sort logic
  // (identity.groupStudiosForArtist); we just call it once here.
  const caller = appRouter.createCaller({ userId });
  const { studios } = await caller.artist.studios();

  return (
    <AppI18nProvider>
      <ArtistAppShell isProducer={!!producerRow} studios={studios}>
        {children}
      </ArtistAppShell>
    </AppI18nProvider>
  );
}
