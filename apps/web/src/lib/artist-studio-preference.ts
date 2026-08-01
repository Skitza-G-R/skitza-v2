export const ARTIST_STUDIO_PREFERENCE_COOKIE = "skitza-artist-studio";
export const ARTIST_STUDIO_PREFERENCE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const PREFERENCE_VERSION = 1;

export type ArtistStudioPreference = {
  userId: string;
  studioId: string;
};

export function encodeArtistStudioPreference(preference: ArtistStudioPreference): string {
  return encodeURIComponent(
    JSON.stringify({
      v: PREFERENCE_VERSION,
      u: preference.userId,
      s: preference.studioId,
    }),
  );
}

export function decodeArtistStudioPreference(
  value: string | null | undefined,
): ArtistStudioPreference | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("v" in parsed) ||
      parsed.v !== PREFERENCE_VERSION ||
      !("u" in parsed) ||
      typeof parsed.u !== "string" ||
      parsed.u.length === 0 ||
      !("s" in parsed) ||
      typeof parsed.s !== "string" ||
      parsed.s.length === 0
    ) {
      return null;
    }
    return { userId: parsed.u, studioId: parsed.s };
  } catch {
    return null;
  }
}

export function artistStudioPreferenceForUser(
  value: string | null | undefined,
  userId: string,
): string | null {
  const preference = decodeArtistStudioPreference(value);
  return preference?.userId === userId ? preference.studioId : null;
}
