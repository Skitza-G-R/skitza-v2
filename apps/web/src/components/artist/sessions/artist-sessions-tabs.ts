export const ARTIST_SESSIONS_TAB_KEYS = ["upcoming", "history"] as const;

export type ArtistSessionsTabKey = (typeof ARTIST_SESSIONS_TAB_KEYS)[number];

export function isArtistSessionsTabKey(value: unknown): value is ArtistSessionsTabKey {
  return (
    typeof value === "string" && (ARTIST_SESSIONS_TAB_KEYS as readonly string[]).includes(value)
  );
}

export const ARTIST_SESSIONS_TABS: readonly Readonly<{
  key: ArtistSessionsTabKey;
  label: string;
}>[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "history", label: "History" },
];
