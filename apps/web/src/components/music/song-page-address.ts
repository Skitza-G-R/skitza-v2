import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";

import type { SongPageRole } from "./song-page";

const PRODUCER_SONG_PATH = /^\/dashboard\/music\/[^/]+$/;
const ARTIST_SONG_PATH = /^\/artist\/music\/song\/[^/]+$/;

export function songPagePathForVersion(
  role: SongPageRole,
  versionId: string,
  currentPathname?: string,
): string | null {
  const encodedVersionId = encodeURIComponent(versionId);
  if (role === "producer") return `/dashboard/music/${encodedVersionId}`;
  if (role === "artist") return `/artist/music/song/${encodedVersionId}`;
  if (!currentPathname) return null;
  if (PRODUCER_SONG_PATH.test(currentPathname)) {
    return `/dashboard/music/${encodedVersionId}`;
  }
  if (ARTIST_SONG_PATH.test(currentPathname)) {
    return `/artist/music/song/${encodedVersionId}`;
  }
  return null;
}

export function canonicalSongPageAddress(role: Exclude<SongPageRole, "guest">, versionId: string) {
  const pathname = songPagePathForVersion(role, versionId);
  if (!pathname) throw new Error("Could not build Song page address");
  return `${PUBLIC_BRAND_ORIGIN}${pathname}`;
}

export function replaceBrowserSongPageVersion(role: SongPageRole, versionId: string): void {
  if (typeof window === "undefined") return;
  const pathname = songPagePathForVersion(role, versionId, window.location.pathname);
  if (!pathname) return;

  const nextUrl = new URL(window.location.href);
  nextUrl.pathname = pathname;
  nextUrl.searchParams.delete("t");
  nextUrl.searchParams.delete("_vercel_share");
  window.history.replaceState(
    window.history.state,
    "",
    `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
  );
}
