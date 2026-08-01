import { ArtistAppShell } from "~/components/artist/artist-app-shell";
import { AppI18nProvider } from "~/i18n/app-i18n-provider";
import { resolveArtistStudioId } from "~/lib/artist-studio-context";
import { readArtistStudioPreference } from "~/server/artist/studio-preference";
import { appRouter } from "~/server/trpc/routers/_app";
import { requireRole } from "~/server/auth/role";
import {
  and,
  createDb,
  eq,
  isNull,
  notifications,
  sql,
} from "@skitza/db";

// Server component. Runs on every /artist/* navigation. Role gate +
// orphan/producer/incomplete redirects live in requireRole — see
// server/auth/role.ts. After the gate, this layout loads the chrome
// state the shell needs: the studio list and the dual-role flag.
export default async function ArtistLayout({ children }: { children: React.ReactNode }) {
  const {
    userId,
    producerProfileStatus,
    producerProfileId,
  } = await requireRole("artist");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  // Preload the studio list so the Studio Switcher renders immediately
  // on every /artist/* navigation instead of suspending. The tRPC
  // procedure is the single source of truth for the dedup + sort logic
  // (identity.groupStudiosForArtist); we just call it once here.
  //
  const caller = appRouter.createCaller({ userId });
  const producerUnreadPromise = producerProfileId
    ? createDb(dbUrl)
        .select({ value: sql<number>`count(*)`.mapWith(Number) })
        .from(notifications)
        .where(
          and(
            eq(notifications.producerId, producerProfileId),
            isNull(notifications.readAt),
            isNull(notifications.archivedAt),
          ),
        )
        .then((rows) => rows[0]?.value ?? 0)
    : Promise.resolve(0);
  const [
    { studios },
    savedStudioId,
    notificationUnreadCount,
    notificationStudioDotIds,
    producerNotificationUnreadCount,
  ] =
    await Promise.all([
      caller.artist.studios(),
      readArtistStudioPreference(userId),
      caller.artistPlatform.notifications.unreadCount(),
      caller.artistPlatform.notifications.studioDots(),
      producerUnreadPromise,
    ]);
  const initialStudioId = resolveArtistStudioId(studios, null, savedStudioId);

  return (
    <AppI18nProvider>
      <ArtistAppShell
        userId={userId}
        producerStatus={producerProfileStatus}
        producerNotificationUnreadCount={producerNotificationUnreadCount}
        studios={studios}
        initialStudioId={initialStudioId}
        notificationUnreadCount={notificationUnreadCount}
        notificationStudioDotIds={notificationStudioDotIds}
      >
        {children}
      </ArtistAppShell>
    </AppI18nProvider>
  );
}
