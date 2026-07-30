import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ArtistSettingsClient } from "~/components/artist/settings/artist-settings-client";
import { isArtistSettingsSectionKey } from "~/components/artist/settings/artist-settings-sections";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function ArtistSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;
  const initialActive = isArtistSettingsSectionKey(params.section) ? params.section : "profile";
  const caller = appRouter.createCaller({ userId });
  const [user, { studios }, profile, pastStudios] = await Promise.all([
    currentUser(),
    caller.artist.studios(),
    caller.artistPlatform.profile.get(),
    caller.artistPlatform.history.studios(),
  ]);

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "Artist";
  const joinedLabel = user?.createdAt
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        year: "numeric",
      }).format(new Date(user.createdAt))
    : null;

  return (
    <div className="pb-8">
      <header className="mx-auto mb-6 w-full max-w-5xl">
        <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[rgb(var(--brand-primary))] uppercase">
          Your account
        </p>
        <h1 className="font-display mt-1 text-[32px] leading-none font-extrabold tracking-[-0.04em] text-[rgb(var(--fg-default))] sm:text-[38px]">
          Settings
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          Manage your profile, timezone, notifications, and studio connections.
        </p>
      </header>

      <ArtistSettingsClient
        initialActive={initialActive}
        identity={{
          fullName,
          email: user?.primaryEmailAddress?.emailAddress ?? "—",
          imageUrl: user?.imageUrl ?? null,
          joinedLabel,
        }}
        initialTimezone={profile.timezone}
        initialPreferences={profile.notificationPreferences}
        connectedStudios={studios}
        pastStudios={pastStudios.map((studio) => ({
          producerId: studio.producerId,
          name: studio.name,
          slug: studio.slug,
          logoUrl: studio.logoUrl,
          disconnectedAtIso: studio.disconnectedAt.toISOString(),
        }))}
      />
    </div>
  );
}
