import {
  artistProfiles,
  eq,
  sql,
  type ArtistNotificationPreferences,
  type ArtistNotificationPreferenceCategory,
  type Db,
} from "@skitza/db";

export const ARTIST_NOTIFICATION_CATEGORIES = [
  "purchase",
  "proof",
  "booking",
  "session_reminder",
  "new_music",
  "producer_comment",
] as const satisfies readonly ArtistNotificationPreferenceCategory[];

export type ResolvedArtistNotificationPreference = Readonly<{
  inApp: boolean;
  transactionalEmail: boolean;
  activityEmail: boolean;
}>;

export type ResolvedArtistNotificationPreferences = Readonly<
  Record<ArtistNotificationPreferenceCategory, ResolvedArtistNotificationPreference>
>;

const TRANSACTIONAL_CATEGORIES = new Set<ArtistNotificationPreferenceCategory>([
  "purchase",
  "proof",
  "booking",
  "session_reminder",
]);

const ACTIVITY_CATEGORIES = new Set<ArtistNotificationPreferenceCategory>([
  "new_music",
  "producer_comment",
]);

export function defaultArtistNotificationPreferences(): ResolvedArtistNotificationPreferences {
  return Object.fromEntries(
    ARTIST_NOTIFICATION_CATEGORIES.map((category) => [
      category,
      {
        inApp: true,
        transactionalEmail: TRANSACTIONAL_CATEGORIES.has(category),
        activityEmail: false,
      },
    ]),
  ) as ResolvedArtistNotificationPreferences;
}

export function resolveArtistNotificationPreferences(
  stored: ArtistNotificationPreferences | null | undefined,
): ResolvedArtistNotificationPreferences {
  const defaults = defaultArtistNotificationPreferences();
  return Object.fromEntries(
    ARTIST_NOTIFICATION_CATEGORIES.map((category) => {
      const value = stored?.[category];
      return [
        category,
        {
          inApp:
            typeof value?.inApp === "boolean"
              ? value.inApp
              : defaults[category].inApp,
          transactionalEmail: TRANSACTIONAL_CATEGORIES.has(category)
            ? typeof value?.transactionalEmail === "boolean"
              ? value.transactionalEmail
              : defaults[category].transactionalEmail
            : false,
          activityEmail: ACTIVITY_CATEGORIES.has(category)
            ? typeof value?.activityEmail === "boolean"
              ? value.activityEmail
              : defaults[category].activityEmail
            : false,
        },
      ];
    }),
  ) as ResolvedArtistNotificationPreferences;
}

export function isValidIanaTimezone(value: string): boolean {
  const timezone = value.trim();
  if (timezone.length === 0 || timezone.length > 100 || timezone !== value) {
    return false;
  }
  if (timezone !== "UTC" && !timezone.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export async function getArtistProfile(
  db: Db,
  clerkUserId: string,
): Promise<{
  timezone: string | null;
  notificationPreferences: ResolvedArtistNotificationPreferences;
}> {
  const [profile] = await db
    .select({
      timezone: artistProfiles.timezone,
      notificationPreferences: artistProfiles.notificationPreferences,
    })
    .from(artistProfiles)
    .where(eq(artistProfiles.clerkUserId, clerkUserId))
    .limit(1);

  return {
    timezone: profile?.timezone ?? null,
    notificationPreferences: resolveArtistNotificationPreferences(
      profile?.notificationPreferences,
    ),
  };
}

export async function saveArtistTimezone(
  db: Db,
  clerkUserId: string,
  timezone: string,
): Promise<string> {
  if (!isValidIanaTimezone(timezone)) {
    throw new Error("INVALID_TIMEZONE");
  }
  // One clock, and it has to be Postgres's. `created_at` takes the column's
  // own DEFAULT now(), so a JS `new Date()` — read here, before the statement
  // has even reached Neon — is older than the row the database builds around
  // it, and an artist's first save would be rejected by
  // `artist_profiles_timestamp_shape` (CHECK "updated_at" >= "created_at").
  await db
    .insert(artistProfiles)
    .values({ clerkUserId, timezone })
    .onConflictDoUpdate({
      target: artistProfiles.clerkUserId,
      set: { timezone, updatedAt: sql`now()` },
    });
  return timezone;
}

export async function saveArtistNotificationPreferences(
  db: Db,
  clerkUserId: string,
  preferences: ResolvedArtistNotificationPreferences,
): Promise<ResolvedArtistNotificationPreferences> {
  const normalized = resolveArtistNotificationPreferences(preferences);
  // Same one-clock rule as saveArtistTimezone above: the column defaults stamp
  // the insert and now() bumps the conflict path, so `updated_at` is never
  // older than the `created_at` Postgres wrote alongside it.
  await db
    .insert(artistProfiles)
    .values({
      clerkUserId,
      notificationPreferences: normalized,
    })
    .onConflictDoUpdate({
      target: artistProfiles.clerkUserId,
      set: { notificationPreferences: normalized, updatedAt: sql`now()` },
    });
  return normalized;
}
