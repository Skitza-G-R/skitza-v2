import type { ArtistNotificationFeedItem } from "~/components/artist/artist-notification-bell";
import type { ArtistHomeAction } from "~/components/artist/home/home-priority";
import type {
  AllowanceSummary,
  SessionDetail,
  SessionListItem,
} from "~/components/artist/sessions/book-data";
import type { Studio } from "~/server/artist/identity";
import type { ResolvedArtistNotificationPreferences } from "~/server/artist/profile";

export const DEV_ARTIST_NOW_ISO = "2026-08-04T09:00:00.000Z";
export const DEV_ARTIST_STUDIO_ID = "00000000-0000-4000-8000-000000000211";
export const DEV_ARTIST_SECOND_STUDIO_ID = "00000000-0000-4000-8000-000000000212";

export const DEV_ARTIST_STUDIOS = [
  {
    producerId: DEV_ARTIST_STUDIO_ID,
    name: "Northline Studio",
    slug: "northline",
    logoUrl: null,
  },
  {
    producerId: DEV_ARTIST_SECOND_STUDIO_ID,
    name: "Copper Room",
    slug: "copper-room",
    logoUrl: null,
  },
] satisfies Studio[];

export const DEV_ARTIST_HOME_MAIN = {
  id: "00000000-0000-4000-8000-000000000221",
  kind: "new_song",
  title: "Neon Afterglow",
  detail: "Mix v3 · Northline Studio",
  href: "/dev/screens/artist-project-completed",
  actionLabel: "Open song",
  upcomingAt: null,
  occurredAt: new Date("2026-08-04T08:20:00.000Z"),
  isNew: true,
} satisfies ArtistHomeAction;

export const DEV_ARTIST_HOME_SUPPORTING = [
  {
    id: "00000000-0000-4000-8000-000000000222",
    kind: "today_session",
    title: "Mix review",
    detail: "Today, 18:00–19:30",
    href: "/dev/screens/artist-session-detail",
    actionLabel: "View",
    upcomingAt: new Date("2026-08-04T15:00:00.000Z"),
    occurredAt: new Date("2026-08-04T15:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000223",
    kind: "ready_to_schedule",
    title: "Three-song production",
    detail: "2 sessions left",
    href: "/dev/screens/artist-sessions",
    actionLabel: "Book",
    upcomingAt: null,
    occurredAt: new Date("2026-08-01T09:00:00.000Z"),
  },
] satisfies ArtistHomeAction[];

export const DEV_ARTIST_STORE_PRODUCTS = [
  {
    id: "00000000-0000-4000-8000-000000000231",
    name: "Premium single production",
    description:
      "From first arrangement to a release-ready master, with focused creative direction throughout.",
    priceCents: 240_000,
    currency: "ILS",
    pricingModel: "flat" as const,
    volumeTiers: null,
    sessionCount: 3,
    durationMin: 120,
  },
  {
    id: "00000000-0000-4000-8000-000000000232",
    name: "Mix and master",
    description: null,
    priceCents: 95_000,
    currency: "ILS",
    pricingModel: "per_song" as const,
    volumeTiers: [
      { minQty: 1, pricePerUnitCents: 95_000 },
      { minQty: 4, pricePerUnitCents: 82_000 },
    ],
    sessionCount: 1,
    durationMin: 90,
  },
  {
    id: "00000000-0000-4000-8000-000000000233",
    name: "Vocal production bundle",
    description: null,
    priceCents: 78_000,
    currency: "ILS",
    pricingModel: "bundle" as const,
    volumeTiers: null,
    sessionCount: 2,
    durationMin: 60,
  },
];

const DEV_SESSION_BASE = {
  producerId: DEV_ARTIST_STUDIO_ID,
  producerName: "Northline Studio",
  producerSlug: "northline",
  artistTimezone: "America/New_York",
  producerTimezone: "Asia/Jerusalem",
  projectId: "00000000-0000-4000-8000-000000000241",
  projectTitle: "Neon Afterglow",
  purchaseId: "00000000-0000-4000-8000-000000000242",
  sessionAllowanceId: "00000000-0000-4000-8000-000000000243",
  durationMin: 90,
  packageName: "Premium single production",
  locationType: "studio",
  rescheduledFromBookingId: null,
  heldExpiryReason: null,
} as const;

const DEV_ARTIST_SESSION_HISTORY: SessionListItem[] = Array.from({ length: 13 }, (_, index) => {
  const startsAt = new Date(Date.UTC(2026, 6, 18 - index * 7, 11));
  const cancellationDeadline = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
  const wasCancelled = index === 3 || index === 8;
  return {
    ...DEV_SESSION_BASE,
    id: `00000000-0000-4000-8000-${String(246 + index).padStart(12, "0")}`,
    startsAtISO: startsAt.toISOString(),
    packageName: index % 3 === 2 ? "Vocal production" : "Premium single production",
    status: wasCancelled ? "cancelled" : "completed",
    outcome: wasCancelled ? "cancelled_on_time" : "completed",
    policy: {
      cancellationPolicyHours: 24,
      cancellationDeadlineISO: cancellationDeadline.toISOString(),
      isOnTime: false,
      canCancel: false,
      canReschedule: false,
    },
  };
});

export const DEV_ARTIST_SESSIONS = [
  {
    ...DEV_SESSION_BASE,
    id: "00000000-0000-4000-8000-000000000244",
    startsAtISO: "2026-08-05T15:00:00.000Z",
    status: "confirmed",
    outcome: "reserved",
    policy: {
      cancellationPolicyHours: 24,
      cancellationDeadlineISO: "2026-08-04T15:00:00.000Z",
      isOnTime: true,
      canCancel: true,
      canReschedule: true,
    },
  },
  {
    ...DEV_SESSION_BASE,
    id: "00000000-0000-4000-8000-000000000245",
    startsAtISO: "2026-08-08T12:00:00.000Z",
    durationMin: 60,
    packageName: "Vocal production",
    status: "pending_approval",
    outcome: "reserved",
    policy: {
      cancellationPolicyHours: 24,
      cancellationDeadlineISO: "2026-08-07T12:00:00.000Z",
      isOnTime: true,
      canCancel: true,
      canReschedule: false,
    },
  },
  ...DEV_ARTIST_SESSION_HISTORY,
] satisfies SessionListItem[];

export const DEV_ARTIST_ALLOWANCES = [
  {
    purchaseId: DEV_SESSION_BASE.purchaseId,
    sessionAllowanceId: DEV_SESSION_BASE.sessionAllowanceId,
    producerId: DEV_ARTIST_STUDIO_ID,
    producerName: "Northline Studio",
    projectId: DEV_SESSION_BASE.projectId,
    projectTitle: DEV_SESSION_BASE.projectTitle,
    packageName: "Premium single production",
    kind: "fixed",
    sessionLimit: 3,
    sessionsUsed: 1,
    sessionsRemaining: 2,
    durationMin: 90,
    locationType: "studio",
    bufferMinutes: 30,
    minLeadHours: 24,
    closedAtISO: null,
    canBook: true,
    bookingBlockedReason: null,
  },
] satisfies AllowanceSummary[];

export const DEV_ARTIST_SESSION_DETAIL = {
  ...DEV_SESSION_BASE,
  id: "00000000-0000-4000-8000-000000000244",
  startsAtISO: "2026-08-05T15:00:00.000Z",
  status: "confirmed",
  outcome: "reserved",
  policy: {
    cancellationPolicyHours: 24,
    cancellationDeadlineISO: "2026-08-04T15:00:00.000Z",
    isOnTime: true,
    canCancel: true,
    canReschedule: true,
  },
  bufferMinutes: 30,
  minLeadHours: 24,
  autoConfirm: false,
} satisfies SessionDetail;

export const DEV_ARTIST_NOTIFICATION_PREFERENCES = {
  purchase: { inApp: true, transactionalEmail: true, activityEmail: false },
  proof: { inApp: true, transactionalEmail: true, activityEmail: false },
  booking: { inApp: true, transactionalEmail: true, activityEmail: false },
  session_reminder: { inApp: true, transactionalEmail: true, activityEmail: false },
  new_music: { inApp: true, transactionalEmail: false, activityEmail: true },
  producer_comment: { inApp: true, transactionalEmail: false, activityEmail: false },
} satisfies ResolvedArtistNotificationPreferences;

export const DEV_ARTIST_NOTIFICATIONS = [
  {
    id: "00000000-0000-4000-8000-000000000251",
    producerId: DEV_ARTIST_STUDIO_ID,
    producerName: "Northline Studio",
    producerLogoUrl: null,
    kind: "track_version_created",
    title: "New version of Neon Afterglow",
    body: "Mix v3 is ready to hear.",
    readAtIso: null,
    openedAtIso: null,
    createdAtIso: "2026-08-04T08:20:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000252",
    producerId: DEV_ARTIST_SECOND_STUDIO_ID,
    producerName: "Copper Room",
    producerLogoUrl: null,
    kind: "booking_confirmed",
    title: "Session confirmed",
    body: "Your vocal production session is booked.",
    readAtIso: null,
    openedAtIso: null,
    createdAtIso: "2026-08-04T07:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000253",
    producerId: DEV_ARTIST_STUDIO_ID,
    producerName: "Northline Studio",
    producerLogoUrl: null,
    kind: "proof_verified",
    title: "Payment proof verified",
    body: "Your first installment was verified.",
    readAtIso: null,
    openedAtIso: null,
    createdAtIso: "2026-08-03T14:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000254",
    producerId: DEV_ARTIST_STUDIO_ID,
    producerName: "Northline Studio",
    producerLogoUrl: null,
    kind: "producer_comment_created",
    title: "New producer comment",
    body: "The vocal sits beautifully in this chorus.",
    readAtIso: "2026-08-02T11:00:00.000Z",
    openedAtIso: "2026-08-02T11:02:00.000Z",
    createdAtIso: "2026-08-02T10:45:00.000Z",
  },
] satisfies ArtistNotificationFeedItem[];
