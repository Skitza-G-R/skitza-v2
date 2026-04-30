import { createDb, eq, producers } from "@skitza/db";
import { ArtistAppShell } from "~/components/artist/artist-app-shell";
import { AppI18nProvider } from "~/i18n/app-i18n-provider";
import { appRouter } from "~/server/trpc/routers/_app";
import { requireRole } from "~/server/auth/role";

// Server component. Runs on every /artist/* navigation. Role gate +
// orphan/producer/incomplete redirects live in requireRole — see
// server/auth/role.ts. After the gate, this layout loads the chrome
// state the shell needs: the studio list and the dual-role flag.
export default async function ArtistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await requireRole("artist");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const db = createDb(dbUrl);

  const [producerRow] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);

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
