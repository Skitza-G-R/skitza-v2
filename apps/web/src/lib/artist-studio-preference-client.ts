"use client";

import {
  ARTIST_STUDIO_PREFERENCE_COOKIE,
  ARTIST_STUDIO_PREFERENCE_MAX_AGE_SECONDS,
  encodeArtistStudioPreference,
} from "./artist-studio-preference";

export function writeArtistStudioPreferenceCookie(userId: string, studioId: string): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    [
      `${ARTIST_STUDIO_PREFERENCE_COOKIE}=${encodeArtistStudioPreference({
        userId,
        studioId,
      })}`,
      "Path=/",
      `Max-Age=${String(ARTIST_STUDIO_PREFERENCE_MAX_AGE_SECONDS)}`,
      "SameSite=Lax",
    ].join("; ") + secure;
}

export function clearArtistStudioPreferenceCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = [
    `${ARTIST_STUDIO_PREFERENCE_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
  ].join("; ");
}
