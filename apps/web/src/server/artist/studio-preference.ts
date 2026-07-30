import { cookies } from "next/headers";

import {
  ARTIST_STUDIO_PREFERENCE_COOKIE,
  artistStudioPreferenceForUser,
} from "~/lib/artist-studio-preference";

export async function readArtistStudioPreference(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  return artistStudioPreferenceForUser(
    cookieStore.get(ARTIST_STUDIO_PREFERENCE_COOKIE)?.value,
    userId,
  );
}
