import {
  and,
  asc,
  availabilityBlocks,
  bookings,
  clientContacts,
  desc,
  eq,
  gte,
  inArray,
  invoices,
  isNull,
  lte,
  notInArray,
  producers,
  products,
  projects,
  projectTracks,
  trackComments,
  trackVersions,
} from "@skitza/db";
import type { Db, PaymentPlan } from "@skitza/db";
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

      // Versions + comments: scope both SELECTs at the DB layer via
      // inArray. Short-circuit when there are no tracks (and, below, no
      // versions) so we skip an otherwise-pointless round-trip. This
      // used to filter in JS after a full-table SELECT — a severe perf
      // cliff as the platform grows, and a tenant-scope smell.
      const allVersions = trackIds.length
        ? await ctx.db
            .select()
            .from(trackVersions)
            .where(inArray(trackVersions.trackId, trackIds))
            .orderBy(desc(trackVersions.uploadedAt))
        : [];

      const versionIds = allVersions.map((v) => v.id);
      const allComments = versionIds.length
        ? await ctx.db
            .select()
            .from(trackComments)
            .where(inArray(trackComments.versionId, versionIds))
            .orderBy(asc(trackComments.createdAt))
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
        body: z.string().trim().min(1).max(2000),
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

// ─── Access guard for book procedures ────────────────────────────────
// Mirrors resolveProjectOwnership but scopes by (clerkUserId, producerId)
// instead of by project. The booking path doesn't care about a specific
// project; it cares that this signed-in Clerk user has any
// clientContacts row tied to this producer. That row's email + name
// become the booking's `artistEmail`/`artistName` snapshot.
//
// NOT_FOUND on miss (matches the music procedures) — we intentionally
// don't distinguish "producer doesn't exist" from "producer exists but
// this artist has no relationship with them".
async function resolveClientContact(
  db: Db,
  clerkUserId: string,
  producerId: string,
): Promise<typeof clientContacts.$inferSelect> {
  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clerkUserId, clerkUserId),
        eq(clientContacts.producerId, producerId),
      ),
    )
    .limit(1);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
  return contact;
}

// ─── artist.book sub-router ──────────────────────────────────────────
// Block-based weekly calendar for the artist's self-serve booking flow.
//
// `availability` returns a fixed 14-day window. Each day carries up to
// two blocks (morning + evening) derived from the producer's weekly
// `availabilityBlocks` config. A block's `available` flag falls to
// false whenever an existing booking (any status other than rejected/
// cancelled) overlaps it. For MVP we treat a block as one bookable
// unit — a single booking anywhere inside it flips the whole block
// closed rather than tracking sub-slot occupancy.
//
// `freeBookingProjectId` is the carryover: if the artist has an
// active, deposit-paid project with this producer that isn't final-
// paid yet, we surface it so the UI can label the booking "On the
// house" and skip the Stripe checkout step. The router's WHERE clause
// excludes stages (paid/archived/cancelled) that wouldn't qualify, so
// a null result here is the router saying "no carryover available".
const bookSubrouter = router({
  availability: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // 1. Access guard — the producer must be one of the artist's
      //    studios. NOT_FOUND on miss.
      const contact = await resolveClientContact(
        ctx.db,
        ctx.clerkUserId,
        input.producerId,
      );

      // 2. Build the 14-day window. Dates are surfaced as "YYYY-MM-DD"
      //    (no TZ) — the UI renders them in the device's locale. Using
      //    UTC calendar math here is a simplification: the producer's
      //    timezone doesn't shift day boundaries in the strip. A
      //    follow-up would plumb `producers.timezone` through.
      const now = new Date();
      const today = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const horizon = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

      // 3. Fan out the three SELECTs we need.
      const [blockRows, bookingRows, projectRows] = await Promise.all([
        // Weekly recurring config — 0..2 rows per weekday.
        ctx.db
          .select({
            weekday: availabilityBlocks.weekday,
            startMin: availabilityBlocks.startMin,
            endMin: availabilityBlocks.endMin,
          })
          .from(availabilityBlocks)
          .where(eq(availabilityBlocks.producerId, input.producerId)),

        // Existing bookings in the window — any status except the
        // "not going to happen" ones. A pending hold still blocks the
        // block so someone else's in-flight booking doesn't get
        // double-booked in this race window.
        ctx.db
          .select({
            startsAt: bookings.startsAt,
            durationMin: bookings.durationMin,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.producerId, input.producerId),
              inArray(bookings.status, ["pending", "confirmed"]),
              gte(bookings.startsAt, today),
              lte(bookings.startsAt, horizon),
            ),
          ),

        // Free-session carryover: deposit_paid AND final_paid=false,
        // stage in an actively-working state. First match wins (the
        // artist has one active project per producer in practice).
        ctx.db
          .select({
            id: projects.id,
            title: projects.title,
          })
          .from(projects)
          .where(
            and(
              eq(projects.producerId, input.producerId),
              eq(projects.artistEmail, contact.email),
              eq(projects.depositPaid, true),
              eq(projects.finalPaid, false),
              notInArray(projects.stage, ["paid", "archived", "cancelled"]),
            ),
          )
          .limit(1),
      ]);

      // 4. Index blocks by weekday → { morning?, evening? }. When a
      //    producer publishes both, the lower-startMin is morning and
      //    the other is evening.
      type BlockShape = { startMin: number; endMin: number };
      const blocksByWeekday = new Map<
        number,
        { morning: BlockShape | null; evening: BlockShape | null }
      >();
      for (const b of blockRows) {
        const existing = blocksByWeekday.get(b.weekday) ?? {
          morning: null,
          evening: null,
        };
        const block = { startMin: b.startMin, endMin: b.endMin };
        if (!existing.morning) {
          existing.morning = block;
        } else if (block.startMin < existing.morning.startMin) {
          // Incoming is earlier → demote current morning to evening.
          existing.evening = existing.morning;
          existing.morning = block;
        } else {
          existing.evening = block;
        }
        blocksByWeekday.set(b.weekday, existing);
      }

      // 5. Walk 14 days. For each, compute date + weekday + block
      //    availability. "Conflict" = any booking whose [startsAt,
      //    startsAt+durationMin) interval overlaps the block's
      //    [dayStart+startMin, dayStart+endMin).
      const days = [];
      for (let i = 0; i < 14; i++) {
        const dayUtc = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
        const dateStr = `${String(dayUtc.getUTCFullYear())}-${String(
          dayUtc.getUTCMonth() + 1,
        ).padStart(2, "0")}-${String(dayUtc.getUTCDate()).padStart(2, "0")}`;
        const weekday = dayUtc.getUTCDay();
        const blocks = blocksByWeekday.get(weekday);

        const buildSlot = (b: BlockShape | null) => {
          if (!b) return null;
          const blockStart = new Date(
            dayUtc.getTime() + b.startMin * 60 * 1000,
          );
          const blockEnd = new Date(dayUtc.getTime() + b.endMin * 60 * 1000);
          const conflict = bookingRows.some((bk) => {
            const bkEnd = new Date(
              bk.startsAt.getTime() + bk.durationMin * 60 * 1000,
            );
            return bk.startsAt < blockEnd && blockStart < bkEnd;
          });
          return { startMin: b.startMin, endMin: b.endMin, available: !conflict };
        };

        days.push({
          date: dateStr,
          weekday,
          morning: buildSlot(blocks?.morning ?? null),
          evening: buildSlot(blocks?.evening ?? null),
        });
      }

      const freeProject = projectRows[0];
      return {
        days,
        freeBookingProjectId: freeProject?.id ?? null,
        freeBookingProjectTitle: freeProject?.title ?? null,
      };
    }),

  confirm: artistProcedure
    .input(
      z.object({
        producerId: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        block: z.enum(["morning", "evening"]),
        startMin: z.number().int().min(0).max(1440),
        durationMin: z.number().int().min(15).max(720),
        projectId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Access guard — same as availability.
      const contact = await resolveClientContact(
        ctx.db,
        ctx.clerkUserId,
        input.producerId,
      );

      // 2. Compute startsAt from date + startMin. Treating the date as
      //    UTC midnight matches the availability query's day math so
      //    the slot the UI picked lines up with the row we insert.
      const [yearStr, monthStr, dayStr] = input.date.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      if (!year || !month || !day) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid date" });
      }
      const startsAt = new Date(
        Date.UTC(year, month - 1, day, 0, 0) + input.startMin * 60 * 1000,
      );

      // 3. Race-safe overlap check. Pulls every active booking in a
      //    wide (±24h) window around the requested slot; the SQL-level
      //    narrower check is harder to express in drizzle and the row
      //    count is always tiny for a single producer. Then we do the
      //    precise overlap test in JS: slot and existing overlap iff
      //    slot.start < existing.end AND existing.start < slot.end.
      const endsAt = new Date(
        startsAt.getTime() + input.durationMin * 60 * 1000,
      );
      const candidates = await ctx.db
        .select({
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, input.producerId),
            inArray(bookings.status, ["pending", "confirmed"]),
            gte(
              bookings.startsAt,
              new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
            ),
            lte(bookings.startsAt, endsAt),
          ),
        );
      const overlap = candidates.some((bk) => {
        const bkEnd = new Date(
          bk.startsAt.getTime() + bk.durationMin * 60 * 1000,
        );
        return bk.startsAt < endsAt && startsAt < bkEnd;
      });
      if (overlap) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "slot no longer available",
        });
      }

      // 4. Insert.
      const [row] = await ctx.db
        .insert(bookings)
        .values({
          producerId: input.producerId,
          artistEmail: contact.email,
          artistName: contact.name,
          startsAt,
          durationMin: input.durationMin,
          status: "confirmed",
          statusChangedAt: new Date(),
          projectId: input.projectId,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return { id: row.id };
    }),
});

// ─── artist.store sub-router ─────────────────────────────────────────
// Browse + buy products from any of the artist's studios without
// leaving the artist app. `products` is the catalog read (all or one
// studio), `product` is the detail read, `checkout` mints a Stripe
// Checkout Session via the shared `initiatePaidPlanCheckout` helper.
//
// The helper is also used by `booking.publicRequest`, so the public
// booking flow and the signed-in artist Store hit the same plan-aware
// Stripe Connect + invoice-ledger code. Both paths get the same
// plan-validation guard (BAD_REQUEST on unlisted plans) and the same
// project row shape in `lead` stage.
const storeSubrouter = router({
  // List products the artist can buy. `producerId` optional: when
  // undefined, returns the union of products across all the artist's
  // studios; when provided, filters to that one studio (but still
  // access-gates on clientContacts so an artist can't enumerate a
  // producer they haven't worked with).
  //
  // Sort order: producerName asc → position asc. Within a single
  // studio the producer's drag order is preserved; across studios the
  // grouping is alphabetical for stable rendering.
  //
  // Excludes archived (`archivedAt IS NOT NULL`) and inactive
  // (`active = false`) products at the DB layer so the list is
  // always live-sellable.
  products: artistProcedure
    .input(
      z.object({ producerId: z.string().uuid().optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const producerId = input?.producerId;

      // 1. Auth boundary — resolve my studios. Empty list short-circuits
      //    to an empty catalog. When producerId is provided we additionally
      //    require a clientContacts row for THAT producer so an artist
      //    can't fish for a producer's catalog without a relationship.
      const myContacts = await ctx.db
        .select({
          id: clientContacts.id,
          producerId: clientContacts.producerId,
          email: clientContacts.email,
        })
        .from(clientContacts)
        .where(eq(clientContacts.clerkUserId, ctx.clerkUserId));

      const myProducerIds = [
        ...new Set(myContacts.map((c) => c.producerId)),
      ];

      // With a specific producerId filter, require an explicit
      // clientContacts row — otherwise an artist could probe a
      // producer's catalog without a relationship. Throws BEFORE the
      // empty-studios short-circuit so a signed-in user who's not yet
      // a client anywhere gets NOT_FOUND (informative) rather than []
      // (ambiguous).
      if (producerId !== undefined && !myProducerIds.includes(producerId)) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (myContacts.length === 0) {
        return { products: [] as StoreProductRow[] };
      }

      const scopedProducerIds =
        producerId === undefined ? myProducerIds : [producerId];

      // 2. Products ⨝ producers. scopedProducerIds is always ≥ 1 entry
      //    here because we short-circuited on empty above.
      const rows = await ctx.db
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          priceCents: products.priceCents,
          currency: products.currency,
          durationMin: products.durationMin,
          sessionCount: products.sessionCount,
          kind: products.kind,
          pricingModel: products.pricingModel,
          paymentPlans: products.paymentPlans,
          position: products.position,
          producerId: products.producerId,
          producerName: producers.displayName,
          producerSlug: producers.slug,
        })
        .from(products)
        .innerJoin(producers, eq(producers.id, products.producerId))
        .where(
          and(
            inArray(products.producerId, scopedProducerIds),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .orderBy(asc(producers.displayName), asc(products.position));

      const mapped: StoreProductRow[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        priceCents: r.priceCents,
        currency: r.currency,
        durationMin: r.durationMin,
        sessionCount: r.sessionCount,
        kind: r.kind,
        pricingModel: r.pricingModel as
          | "flat"
          | "per_song"
          | "hourly"
          | "bundle",
        paymentPlans: r.paymentPlans,
        producerId: r.producerId,
        producerName: r.producerName ?? "Untitled Studio",
        producerSlug: r.producerSlug,
      }));

      return { products: mapped };
    }),

  // Single product detail. Access-gated on (clerkUserId, producerId) —
  // rejects with NOT_FOUND if the artist doesn't have a clientContacts
  // row for this product's producer.
  product: artistProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          priceCents: products.priceCents,
          currency: products.currency,
          durationMin: products.durationMin,
          sessionCount: products.sessionCount,
          kind: products.kind,
          pricingModel: products.pricingModel,
          paymentPlans: products.paymentPlans,
          position: products.position,
          producerId: products.producerId,
          producerName: producers.displayName,
          producerSlug: producers.slug,
        })
        .from(products)
        .innerJoin(producers, eq(producers.id, products.producerId))
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      // Ownership guard — artist must have a clientContacts row for
      // this product's producer. Reject with NOT_FOUND (not FORBIDDEN)
      // so a non-customer can't distinguish "product doesn't exist"
      // from "product exists but you haven't worked with this studio".
      const contacts = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, row.producerId),
          ),
        )
        .limit(1);
      if (contacts.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        priceCents: row.priceCents,
        currency: row.currency,
        durationMin: row.durationMin,
        sessionCount: row.sessionCount,
        kind: row.kind,
        pricingModel: row.pricingModel as
          | "flat"
          | "per_song"
          | "hourly"
          | "bundle",
        paymentPlans: row.paymentPlans,
        producerId: row.producerId,
        producerName: row.producerName ?? "Untitled Studio",
        producerSlug: row.producerSlug,
      };
    }),

  // Mint a Stripe Checkout Session for this (artist, product, plan).
  // Same as booking.publicRequest's branch (a) minus the booking row —
  // store purchases don't create a bookings row because there's no
  // session to book; the project row in `lead` stage (created by the
  // shared helper) is the canonical ledger entry.
  //
  // Returns the Checkout URL so the server action can redirect.
  checkout: artistProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        paymentPlan: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("full") }),
          z.object({ kind: z.literal("split_50_50") }),
          z.object({
            kind: z.literal("monthly"),
            installments: z.number().int().min(2).max(12),
          }),
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Load product. NOT_FOUND if missing or soft-deleted.
      const [prod] = await ctx.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.active, true),
            isNull(products.archivedAt),
          ),
        )
        .limit(1);
      if (!prod) throw new TRPCError({ code: "NOT_FOUND" });

      // 2. Ownership guard + surface the client identity (name + email)
      //    for the Stripe Customer. artistProcedure guarantees
      //    clerkUserId is set; we still have to pull the contact row
      //    to know the raw email and display name used for the session.
      const [contact] = await ctx.db
        .select({
          id: clientContacts.id,
          email: clientContacts.email,
          name: clientContacts.name,
        })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, prod.producerId),
          ),
        )
        .limit(1);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

      // 3. Producer's Stripe Connect fields. stripeAccountId must be
      //    set AND charges must be enabled, otherwise we can't route
      //    funds. Pre-flight check returns a clean BAD_REQUEST instead
      //    of a confusing Stripe error.
      const [producerRow] = await ctx.db
        .select({
          stripeAccountId: producers.stripeAccountId,
          stripeChargesEnabled: producers.stripeChargesEnabled,
          slug: producers.slug,
        })
        .from(producers)
        .where(eq(producers.id, prod.producerId))
        .limit(1);

      if (
        !producerRow?.stripeAccountId ||
        !producerRow.stripeChargesEnabled
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This studio isn't set up to accept payments yet — reach out directly.",
        });
      }

      // 4. Delegate to the shared helper. Plan validation happens inside
      //    (throws BAD_REQUEST on unlisted plans). Helper handles:
      //    - client_contacts upsert (no-op here since we already have one)
      //    - Stripe Customer lookup/create
      //    - projects row insert (lead stage, plan snapshot)
      //    - Stripe Checkout Session create (idempotency-keyed)
      //    - invoices row for full/split; skipped for monthly.
      const { initiatePaidPlanCheckout } = await import(
        "~/server/payments/checkout-initiator"
      );

      // Idempotency scope: per (client_contact, product, plan.kind) so
      // a signed-in artist spamming "Continue to checkout" on the same
      // plan doesn't fan out into duplicate Stripe sessions. Switching
      // plan variants (full → monthly) gives a distinct key.
      const planKey =
        input.paymentPlan.kind === "monthly"
          ? `monthly-${String(input.paymentPlan.installments)}`
          : input.paymentPlan.kind;
      const idempotencyKey = `store-${contact.id}-${prod.id}-${planKey}-checkout`;

      const plan: PaymentPlan = input.paymentPlan;
      const result = await initiatePaidPlanCheckout({
        db: ctx.db,
        producer: {
          id: prod.producerId,
          slug: producerRow.slug,
          stripeAccountId: producerRow.stripeAccountId,
        },
        product: prod,
        paymentPlan: plan,
        clientName: contact.name,
        clientEmail: contact.email,
        priceCents: prod.priceCents,
        idempotencyKey,
        metadata: { source: "artist_store" },
      });

      return {
        checkoutUrl: result.checkoutUrl,
        projectId: result.projectId,
      };
    }),
});

// Per-row shape returned by artist.store.products — exported for the
// UI component's prop type.
export type StoreProductRow = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  durationMin: number;
  sessionCount: number;
  kind: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  paymentPlans: PaymentPlan[];
  producerId: string;
  producerName: string;
  producerSlug: string;
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

  // Block-based weekly calendar. availability + confirm for the
  // self-serve booking flow. See bookSubrouter for per-procedure docs.
  book: bookSubrouter,

  // Catalog + checkout. See storeSubrouter for per-procedure docs.
  store: storeSubrouter,
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

