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
  trackComments,
  trackVersions,
} from "@skitza/db";
import type { Db } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../init";
import { artistProcedure } from "../artist-procedure";
import { groupStudiosForArtist } from "~/server/artist/identity";

// ─── Ownership guard ─────────────────────────────────────────────────
// Resolves the signed-in artist's ownership of a given project. Both
// the `music.project` read and the `music.addComment` write route
// through this helper: the WHERE clause scopes clientContacts by
// (clerkUserId, producerId, email) triplet so someone who shares a
// producer with the project owner but has a different artistEmail can
// NOT see / comment on that project.
//
// Deliberately throws NOT_FOUND (not UNAUTHORIZED / FORBIDDEN) in every
// rejection path so an attacker can't tell "project doesn't exist"
// from "project exists but isn't yours" — both look identical on the
// wire.
async function resolveProjectOwnership(
  db: Db,
  clerkUserId: string,
  projectId: string,
): Promise<{
  project: typeof projects.$inferSelect;
  contact: typeof clientContacts.$inferSelect;
}> {
  // 1. Load the project. If it doesn't exist at all, NOT_FOUND.
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });

  // 2. Find the clientContacts row that (a) belongs to this Clerk
  //    user, (b) is under this project's producer, AND (c) has the
  //    exact email the project was shared with (case-insensitive).
  //    Any miss → NOT_FOUND.
  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clerkUserId, clerkUserId),
        eq(clientContacts.producerId, project.producerId),
        eq(clientContacts.email, project.artistEmail.toLowerCase()),
      ),
    )
    .limit(1);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

  return { project, contact };
}

// ─── artist.music sub-router ─────────────────────────────────────────
// Lives inside the parent artist router. Sibling procedures (project
// detail, addComment, etc.) land here in Task 9, so we set up the
// nesting now even though `projects` is the only entry today.
const musicSubrouter = router({
  // List the signed-in artist's projects across all studios, sorted
  // by most-recent track upload (nulls last so a brand-new project
  // with no uploads yet still appears, just at the bottom). Cap 50
  // because the Music tab is a single-screen list — anyone with > 50
  // projects across all their studios is well into power-user
  // territory and we'd ship pagination before that ever bites.
  //
  // We split into 2 parallel SELECTs and merge in JS instead of one
  // window-function query because Drizzle's window helpers are awkward
  // and the two-query path is far easier to read + test.
  projects: artistProcedure.query(async ({ ctx }) => {
    // 1. Auth boundary — same gating SELECT as artist.home. Empty
    //    short-circuits so we don't fan out to two empty SELECTs.
    const myContacts = await ctx.db
      .select({
        id: clientContacts.id,
        producerId: clientContacts.producerId,
        email: clientContacts.email,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clerkUserId, ctx.clerkUserId));

    if (myContacts.length === 0) {
      return { projects: [] as MusicProjectRow[] };
    }

    const myEmails = [
      ...new Set(myContacts.map((c) => c.email.toLowerCase())),
    ];
    const myProducerIds = [...new Set(myContacts.map((c) => c.producerId))];

    // 2. Fan out: project metadata + per-project track stats.
    //    The track-stats SELECT joins project_tracks → track_versions
    //    so we get count(distinct project_tracks.id) AND the latest
    //    track_version per project (label + parent track title +
    //    upload time). Drizzle doesn't have a clean GROUP BY for this
    //    shape, so we pull all rows and reduce in JS — there are at
    //    most a few hundred versions across the typical artist's
    //    history so the cost is trivial.
    const [projectRows, statsRows] = await Promise.all([
      ctx.db
        .select({
          projectId: projects.id,
          title: projects.title,
          producerId: projects.producerId,
          producerName: producers.displayName,
          producerSlug: producers.slug,
        })
        .from(projects)
        .innerJoin(producers, eq(producers.id, projects.producerId))
        .where(
          and(
            inArray(projects.producerId, myProducerIds),
            inArray(projects.artistEmail, myEmails),
          ),
        ),

      // Pull every (project_id, track title, version label, uploaded_at)
      // tuple for tracks under projects we own. The reduce below picks
      // the latest per project + counts distinct project_tracks.
      ctx.db
        .select({
          projectId: projectTracks.projectId,
          trackId: projectTracks.id,
          trackTitle: projectTracks.title,
          versionLabel: trackVersions.label,
          uploadedAt: trackVersions.uploadedAt,
        })
        .from(projectTracks)
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .leftJoin(trackVersions, eq(trackVersions.trackId, projectTracks.id))
        .where(
          and(
            inArray(projects.producerId, myProducerIds),
            inArray(projects.artistEmail, myEmails),
          ),
        ),
    ]);

    // 3. Reduce stats rows → per-project (trackCount, latest version).
    //    `latestByProject` keys off projectId. The reduce already gives
    //    us a deduped set of trackIds per project, so the count is just
    //    that set's size.
    type Stats = {
      trackIds: Set<string>;
      latestUploadedAt: Date | null;
      latestTrackTitle: string | null;
      latestVersionLabel: string | null;
    };
    const statsByProject = new Map<string, Stats>();
    for (const r of statsRows) {
      const { projectId, trackId, uploadedAt, trackTitle, versionLabel } = r;

      let s = statsByProject.get(projectId);
      if (!s) {
        s = {
          trackIds: new Set(),
          latestUploadedAt: null,
          latestTrackTitle: null,
          latestVersionLabel: null,
        };
        statsByProject.set(projectId, s);
      }
      s.trackIds.add(trackId);
      // leftJoin → uploadedAt may be null if the track has no versions.
      if (
        uploadedAt &&
        (!s.latestUploadedAt ||
          uploadedAt.getTime() > s.latestUploadedAt.getTime())
      ) {
        s.latestUploadedAt = uploadedAt;
        s.latestTrackTitle = trackTitle;
        s.latestVersionLabel = versionLabel;
      }
    }

    // 4. Stitch project rows + stats together.
    const merged: MusicProjectRow[] = projectRows.map((p) => {
      const stats = statsByProject.get(p.projectId);
      return {
        projectId: p.projectId,
        title: p.title,
        producerId: p.producerId,
        producerName: p.producerName ?? "Untitled Studio",
        producerSlug: p.producerSlug,
        latestTrackTitle:
          stats && stats.latestTrackTitle && stats.latestVersionLabel
            ? `${stats.latestVersionLabel} of ${stats.latestTrackTitle}`
            : null,
        latestTrackUploadedAt: stats?.latestUploadedAt ?? null,
        trackCount: stats?.trackIds.size ?? 0,
      };
    });

    // 5. Sort desc by latestTrackUploadedAt with nulls last; cap at 50.
    merged.sort((a, b) => {
      if (a.latestTrackUploadedAt && b.latestTrackUploadedAt) {
        return (
          b.latestTrackUploadedAt.getTime() -
          a.latestTrackUploadedAt.getTime()
        );
      }
      if (a.latestTrackUploadedAt) return -1; // a has date, b is null → a first
      if (b.latestTrackUploadedAt) return 1; // b has date, a is null → b first
      return 0;
    });

    return { projects: merged.slice(0, 50) };
  }),

  // Full detail for one project: tracks (ordered by position) with
  // their version stacks (desc by uploadedAt) and timestamped comments
  // (asc by createdAt, grouped onto the parent track). Powers the Now
  // Playing screen.
  //
  // Auth: resolveProjectOwnership gates on (clerkUserId, producerId,
  // artistEmail) — rejects with NOT_FOUND so we don't leak existence
  // via a differentiated error code.
  project: artistProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { project } = await resolveProjectOwnership(
        ctx.db,
        ctx.clerkUserId,
        input.projectId,
      );

      // Producer display name — separate SELECT because the ownership
      // helper doesn't need it. Not blocking: if the producer row is
      // missing (impossible at runtime given the FK, but defensively)
      // we fall back to "Producer".
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, project.producerId))
        .limit(1);

      // Tracks ordered by position (position ties → createdAt asc).
      const tracksList = await ctx.db
        .select()
        .from(projectTracks)
        .where(eq(projectTracks.projectId, project.id))
        .orderBy(asc(projectTracks.position), asc(projectTracks.createdAt));

      const trackIds = tracksList.map((t) => t.id);

      // Versions + comments: two more SELECTs. We filter by the trackIds
      // set in JS (typical project has < 10 tracks with < 5 versions
      // each, so this keeps the query simple and avoids an inArray
      // round-trip when the set is empty).
      const allVersions = trackIds.length
        ? (
            await ctx.db
              .select()
              .from(trackVersions)
              .orderBy(desc(trackVersions.uploadedAt))
          ).filter((v) => trackIds.includes(v.trackId))
        : [];

      const versionIds = allVersions.map((v) => v.id);
      const allComments = versionIds.length
        ? (
            await ctx.db
              .select()
              .from(trackComments)
              .orderBy(asc(trackComments.createdAt))
          ).filter((c) => versionIds.includes(c.versionId))
        : [];

      // Stitch: each track carries its own versions (desc uploadedAt)
      // and comments (asc createdAt, filtered to its version stack).
      const tracks = tracksList.map((t) => {
        const trackVersionsForTrack = allVersions.filter(
          (v) => v.trackId === t.id,
        );
        const trackVersionIds = trackVersionsForTrack.map((v) => v.id);
        const trackCommentsForTrack = allComments
          .filter((c) => trackVersionIds.includes(c.versionId))
          .map((c) => ({
            id: c.id,
            versionId: c.versionId,
            timeMs: c.timestampMs,
            body: c.body,
            fromProducer: c.fromProducer,
            authorName: c.authorName,
            createdAt: c.createdAt,
            resolvedAt: c.resolvedAt,
          }));
        return {
          id: t.id,
          title: t.title,
          artist: t.artist,
          position: t.position,
          versions: trackVersionsForTrack.map((v) => ({
            id: v.id,
            label: v.label,
            audioUrl: v.audioUrl,
            durationMs: v.durationMs,
            uploadedAt: v.uploadedAt,
            peaksR2Key: v.peaksR2Key,
          })),
          comments: trackCommentsForTrack,
        };
      });

      return {
        project: {
          id: project.id,
          title: project.title,
          producerId: project.producerId,
          producerName: producerRow?.displayName ?? "Producer",
        },
        tracks,
      };
    }),

  // Timestamped comment on a version. The artist (this signed-in user)
  // must own the parent project via the same guard as `project`. The
  // row is tagged fromProducer=false; authorName comes from the
  // clientContacts row (the artist's display name for this producer).
  addComment: artistProcedure
    .input(
      z.object({
        trackVersionId: z.string().uuid(),
        timeMs: z.number().int().min(0),
        body: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Walk version → track → project chain.
      const [version] = await ctx.db
        .select({ id: trackVersions.id, trackId: trackVersions.trackId })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.trackVersionId))
        .limit(1);
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });

      const [track] = await ctx.db
        .select({ id: projectTracks.id, projectId: projectTracks.projectId })
        .from(projectTracks)
        .where(eq(projectTracks.id, version.trackId))
        .limit(1);
      if (!track) throw new TRPCError({ code: "NOT_FOUND" });

      // Same guard as the read query. Throws NOT_FOUND if the artist
      // doesn't have a client_contacts row linking them to the project.
      const { contact } = await resolveProjectOwnership(
        ctx.db,
        ctx.clerkUserId,
        track.projectId,
      );

      const [row] = await ctx.db
        .insert(trackComments)
        .values({
          versionId: input.trackVersionId,
          authorName: contact.name,
          authorEmail: contact.email,
          body: input.body,
          timestampMs: input.timeMs,
          fromProducer: false,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Reshape to match the `project` query's comment shape so the
      // optimistic append on the client never diverges from the server
      // payload.
      return {
        id: row.id,
        versionId: row.versionId,
        timeMs: row.timestampMs,
        body: row.body,
        fromProducer: row.fromProducer,
        authorName: row.authorName,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt,
      };
    }),
});

// Per-project row shape returned by artist.music.projects.
export type MusicProjectRow = {
  projectId: string;
  title: string;
  producerId: string;
  producerName: string;
  producerSlug: string;
  latestTrackTitle: string | null;
  latestTrackUploadedAt: Date | null;
  trackCount: number;
};

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

  // Nested sub-router so future siblings (project detail, addComment,
  // etc.) live under the same `artist.music.*` namespace.
  music: musicSubrouter,
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

