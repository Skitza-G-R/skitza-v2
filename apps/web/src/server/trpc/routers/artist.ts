import {
  and,
  asc,
  bookings,
  clientContacts,
  desc,
  eq,
  gte,
  inArray,
  invoices,
  producers,
  projects,
  projectTracks,
  trackVersions,
} from "@skitza/db";
import { router } from "../init";
import { artistProcedure } from "../artist-procedure";
import { groupStudiosForArtist } from "~/server/artist/identity";

// Artist-scoped router. All procedures here resolve "my studios" via
// client_contacts.clerk_user_id (stamped on first sign-in by the
// Clerk user.created webhook).
export const artistRouter = router({
  // List all producers the signed-in artist has worked with.
  // Drives the Studio Switcher in the artist app header.
  studios: artistProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        producerId: clientContacts.producerId,
        producerName: producers.displayName,
        producerSlug: producers.slug,
        producerLogoUrl: producers.brand,
        lastSeenAt: clientContacts.lastSeenAt,
      })
      .from(clientContacts)
      .innerJoin(producers, eq(producers.id, clientContacts.producerId))
      .where(eq(clientContacts.clerkUserId, ctx.clerkUserId));

    // brand is jsonb {logoUrl?: string, ...} — normalize to scalar
    const flat = rows.map((r) => ({
      producerId: r.producerId,
      producerName: r.producerName ?? "Untitled Studio",
      producerSlug: r.producerSlug,
      producerLogoUrl:
        (r.producerLogoUrl as { logoUrl?: string } | null)?.logoUrl ?? null,
      lastSeenAt: r.lastSeenAt,
    }));

    return { studios: groupStudiosForArtist(flat) };
  }),

  // Home tab feed: next session, latest mix, outstanding balance, and
  // a 10-item activity stream — all in a single round-trip.
  //
  // The query fans out via Promise.all across the artist's studios so a
  // signed-in user with three studios pays the same wall-time as one
  // with one. Each sub-query independently scopes to (myProducerIds, my
  // emails) — the auth boundary is the very first SELECT against
  // client_contacts, which gates every downstream filter on
  // clerkUserId = ctx.userId.
  home: artistProcedure.query(async ({ ctx }) => {
    // 1. Find all my client_contacts rows (producer ids + emails).
    //    This is the auth boundary — every other query below is scoped
    //    to (myProducerIds × myEmails). Empty result short-circuits to
    //    a fully-empty payload so we don't waste a fan-out on someone
    //    with zero studio relationships.
    const myContacts = await ctx.db
      .select({
        id: clientContacts.id,
        producerId: clientContacts.producerId,
        email: clientContacts.email,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clerkUserId, ctx.clerkUserId));

    if (myContacts.length === 0) {
      return {
        nextSession: null,
        latestMix: null,
        outstandingBalance: null,
        activity: [] as ActivityItem[],
      };
    }

    const myEmails = [
      ...new Set(myContacts.map((c) => c.email.toLowerCase())),
    ];
    const myProducerIds = [...new Set(myContacts.map((c) => c.producerId))];

    const now = new Date();

    // 2-5. Parallelize the four data needs. Each sub-query is its own
    // self-contained SELECT; if any one fails the whole call fails
    // (acceptable — Home is a single coherent surface, partial data
    // would be confusing).
    const [
      nextSessionRows,
      latestMixRows,
      outstandingRows,
      activityTrackRows,
      activityBookingRows,
      activityInvoiceRows,
    ] = await Promise.all([
      // (2) Next confirmed session — across all my producers, where
      // the booking's artist email is mine, status=confirmed, in the
      // future. Sort by startsAt ASC so the very next one wins.
      ctx.db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          productName: bookings.packageNameSnapshot,
        })
        .from(bookings)
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .where(
          and(
            inArray(bookings.producerId, myProducerIds),
            inArray(bookings.artistEmail, myEmails),
            eq(bookings.status, "confirmed"),
            gte(bookings.startsAt, now),
          ),
        )
        .orderBy(asc(bookings.startsAt))
        .limit(1),

      // (3) Latest mix — the most recent track_version uploaded for
      // any project tied to my (producer, email). Joins through the
      // project_tracks → projects chain because track_versions only
      // know their parent track, not the project's owner.
      ctx.db
        .select({
          id: trackVersions.id,
          trackTitle: projectTracks.title,
          label: trackVersions.label,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          projectId: projects.id,
          uploadedAt: trackVersions.uploadedAt,
          audioUrl: trackVersions.audioUrl,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .innerJoin(producers, eq(producers.id, projects.producerId))
        .where(
          and(
            inArray(projects.producerId, myProducerIds),
            inArray(projects.artistEmail, myEmails),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(1),

      // (4) Outstanding balance — sum of unpaid invoices across my
      // studios, scoped to my customer email. Status != 'paid' covers
      // draft + sent + uncollectible (refunded/void are excluded — a
      // refunded invoice is not money you owe).
      ctx.db
        .select({
          amountCents: invoices.amountCents,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(
          and(
            inArray(invoices.producerId, myProducerIds),
            inArray(invoices.customerEmail, myEmails),
            inArray(invoices.status, ["draft", "sent", "uncollectible"]),
          ),
        ),

      // (5a) Activity — recent track uploads (cap at 10 from this
      // source, then merge + cap at 10 across all sources below).
      ctx.db
        .select({
          id: trackVersions.id,
          trackTitle: projectTracks.title,
          label: trackVersions.label,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          projectId: projects.id,
          uploadedAt: trackVersions.uploadedAt,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .innerJoin(producers, eq(producers.id, projects.producerId))
        .where(
          and(
            inArray(projects.producerId, myProducerIds),
            inArray(projects.artistEmail, myEmails),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(10),

      // (5b) Activity — recent booking confirmations.
      ctx.db
        .select({
          id: bookings.id,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          statusChangedAt: bookings.statusChangedAt,
          startsAt: bookings.startsAt,
        })
        .from(bookings)
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .where(
          and(
            inArray(bookings.producerId, myProducerIds),
            inArray(bookings.artistEmail, myEmails),
            eq(bookings.status, "confirmed"),
          ),
        )
        .orderBy(desc(bookings.statusChangedAt))
        .limit(10),

      // (5c) Activity — recent invoice payments.
      ctx.db
        .select({
          id: invoices.id,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          paidAt: invoices.paidAt,
          amountCents: invoices.amountCents,
          currency: invoices.currency,
          projectId: invoices.projectId,
        })
        .from(invoices)
        .innerJoin(producers, eq(producers.id, invoices.producerId))
        .where(
          and(
            inArray(invoices.producerId, myProducerIds),
            inArray(invoices.customerEmail, myEmails),
            eq(invoices.status, "paid"),
          ),
        )
        .orderBy(desc(invoices.paidAt))
        .limit(10),
    ]);

    // ── Shape the next-session result ────────────────────────────────
    const nextRow = nextSessionRows[0];
    const nextSession = nextRow
      ? {
          id: nextRow.id,
          startsAt: nextRow.startsAt,
          durationMin: nextRow.durationMin,
          producerName: nextRow.producerName ?? "Untitled Studio",
          producerSlug: nextRow.producerSlug,
          productName: nextRow.productName,
        }
      : null;

    // ── Shape the latest-mix result ──────────────────────────────────
    const mixRow = latestMixRows[0];
    const latestMix = mixRow
      ? {
          id: mixRow.id,
          trackTitle: mixRow.trackTitle,
          label: mixRow.label,
          producerName: mixRow.producerName ?? "Untitled Studio",
          producerSlug: mixRow.producerSlug,
          projectId: mixRow.projectId,
          uploadedAt: mixRow.uploadedAt,
          audioUrl: mixRow.audioUrl,
        }
      : null;

    // ── Sum outstanding balance ─────────────────────────────────────
    let outstandingBalance: {
      totalCents: number;
      currency: string;
      nextDueAt: Date | null;
    } | null = null;
    if (outstandingRows.length > 0) {
      const totalCents = outstandingRows.reduce(
        (acc, r) => acc + r.amountCents,
        0,
      );
      // Currency: first row wins (mixed-currency outstanding is rare;
      // we don't try to convert here — the dashboard surfaces a single
      // value in a single currency).
      const currency = outstandingRows[0]?.currency ?? "USD";
      // nextDueAt: when there's a monthly plan running, this is the
      // next scheduled charge. We don't have it surfaced via invoices
      // (the schedule lives on projects.nextChargeAt), so we leave it
      // null for v1. Plumbing it through is a follow-up if/when the UI
      // wants the literal date.
      outstandingBalance = { totalCents, currency, nextDueAt: null };
    }

    // ── Merge + sort + cap activity feed ────────────────────────────
    // Three streams → one normalized stream. We pre-format the message
    // here so the UI is dumb (no business logic in the rendering
    // layer). Sort desc by occurredAt, slice to 10.
    const activity: ActivityItem[] = [];
    for (const r of activityTrackRows) {
      activity.push({
        kind: "track_uploaded",
        message: `${r.producerName ?? "A producer"} uploaded ${r.label} of ${r.trackTitle}`,
        occurredAt: r.uploadedAt,
        producerName: r.producerName ?? "Untitled Studio",
        deepLink: `/artist/music/${r.projectId}`,
      });
    }
    for (const r of activityBookingRows) {
      // statusChangedAt is nullable (legacy rows pre-Phase H.4c); fall
      // back to startsAt so the row still has a sortable timestamp.
      const occurredAt = r.statusChangedAt ?? r.startsAt;
      activity.push({
        kind: "session_confirmed",
        message: `${r.producerName ?? "A producer"} confirmed your session`,
        occurredAt,
        producerName: r.producerName ?? "Untitled Studio",
        deepLink: null,
      });
    }
    for (const r of activityInvoiceRows) {
      // paidAt is nullable in the schema but for status=paid it's
      // always set in practice; defensively skip unset rows so a
      // legacy row can't crash the feed.
      if (!r.paidAt) continue;
      activity.push({
        kind: "invoice_paid",
        message: `Payment of ${formatCents(r.amountCents, r.currency)} processed`,
        occurredAt: r.paidAt,
        producerName: r.producerName ?? "Untitled Studio",
        deepLink: r.projectId ? `/artist/music/${r.projectId}` : null,
      });
    }
    activity.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    const cappedActivity = activity.slice(0, 10);

    return {
      nextSession,
      latestMix,
      outstandingBalance,
      activity: cappedActivity,
    };
  }),
});

// Activity-feed item shape — exported for the component prop type.
export type ActivityItem = {
  kind: "track_uploaded" | "session_confirmed" | "invoice_paid";
  message: string;
  occurredAt: Date;
  producerName: string;
  deepLink: string | null;
};

// Tiny formatter for the activity feed's payment messages. We avoid
// a full Intl roundtrip per row — the activity feed renders 10 items
// at most, but this keeps the function pure + cheap to test elsewhere.
function formatCents(cents: number, currency: string): string {
  const major = (cents / 100).toFixed(2);
  const symbol = currencySymbol(currency);
  return `${symbol}${major}`;
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "ILS":
      return "₪";
    default:
      return `${currency} `;
  }
}

