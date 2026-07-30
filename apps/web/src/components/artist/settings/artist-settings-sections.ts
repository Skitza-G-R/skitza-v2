export const ARTIST_SETTINGS_SECTION_KEYS = [
  "profile",
  "notifications",
  "timezone",
  "studios",
] as const;

export type ArtistSettingsSectionKey = (typeof ARTIST_SETTINGS_SECTION_KEYS)[number];

export function isArtistSettingsSectionKey(value: unknown): value is ArtistSettingsSectionKey {
  return (
    typeof value === "string" && (ARTIST_SETTINGS_SECTION_KEYS as readonly string[]).includes(value)
  );
}

export type ArtistSettingsSection = Readonly<{
  key: ArtistSettingsSectionKey;
  label: string;
  iconKey: "profile" | "notifications" | "timezone" | "studios";
}>;

export const ARTIST_SETTINGS_SECTIONS: readonly ArtistSettingsSection[] = [
  { key: "profile", label: "Profile", iconKey: "profile" },
  {
    key: "notifications",
    label: "Notifications",
    iconKey: "notifications",
  },
  { key: "timezone", label: "Timezone", iconKey: "timezone" },
  { key: "studios", label: "Studios", iconKey: "studios" },
];
