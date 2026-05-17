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
  producers,
  products,
  projects,
  projectTracks,
  sql,
  trackComments,
  trackVersions,
} from "@skitza/db";
import type { Db, PaymentPlan } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";
import { router } from "../init";
import { artistProcedure } from "../artist-procedure";
import { groupStudiosForArtist } from "~/server/artist/identity";
import {
  SITE_URL,
  sendNewCommentFromArtistEmail,
} from "~/server/email/send";
import { getSiteUrl } from "~/server/stripe/client";

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
        isNull(clientContacts.archivedAt),
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
      .where(
        and(
          eq(clientContacts.clerkUserId, ctx.clerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      );

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

      const sessionRows = await ctx.db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          status: bookings.status,
          packageName: bookings.packageNameSnapshot,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.projectId, project.id),
            inArray(bookings.status, [
              "pending_approval",
              "pending_payment",
              "confirmed",
            ]),
          ),
        )
        .orderBy(asc(bookings.startsAt));

      return {
        project: {
          id: project.id,
          title: project.title,
          producerId: project.producerId,
          producerName: producerRow?.displayName ?? "Producer",
          finalPaid: project.finalPaid,
        },
        tracks,
        sessions: sessionRows.map((s) => ({
          id: s.id,
          startsAt: s.startsAt,
          durationMin: s.durationMin,
          status: s.status,
          packageName: s.packageName,
        })),
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
        .select({
          id: projectTracks.id,
          projectId: projectTracks.projectId,
          title: projectTracks.title,
        })
        .from(projectTracks)
        .where(eq(projectTracks.id, version.trackId))
        .limit(1);
      if (!track) throw new TRPCError({ code: "NOT_FOUND" });

      // Same guard as the read query. Throws NOT_FOUND if the artist
      // doesn't have a client_contacts row linking them to the project.
      const { project, contact } = await resolveProjectOwnership(
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

      const [producerRow] = await ctx.db
        .select({ email: producers.email, displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, project.producerId))
        .limit(1);
      if (producerRow?.email) {
        const producerEmail = producerRow.email;
        const producerDisplayName = producerRow.displayName ?? "there";
        after(async () => {
          try {
            await sendNewCommentFromArtistEmail(producerEmail, {
              producerName: producerDisplayName,
              artistName: contact.name,
              trackTitle: track.title,
              commentBody: input.body,
              threadUrl: `${SITE_URL}/dashboard/music`,
            });
          } catch (err) {
            console.error("[email] new-comment-from-artist failed", err);
          }
        });
      }

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
        isNull(clientContacts.archivedAt),
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
// Session-credit carryover lives in `activePackages` (sibling
// procedure) — it's the single source of truth for "does this artist
// have a paid session to spend on this producer?" `availability` is
// now a pure calendar surface: weekly blocks + existing-booking
// conflicts. No project-level state.
const bookSubrouter = router({
  availability: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // 1. Access guard — the producer must be one of the artist's
      //    studios. NOT_FOUND on miss. We don't bind the result; the
      //    side-effect (throw) is the only thing we care about here.
      await resolveClientContact(
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

      // 3. Fan out the two SELECTs we need.
      const [blockRows, bookingRows] = await Promise.all([
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
              inArray(bookings.status, [
                "pending_approval",
                "pending_payment",
                "confirmed",
              ]),
              gte(bookings.startsAt, today),
              lte(bookings.startsAt, horizon),
            ),
          ),
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

      return { days };
    }),

  // Multi-session credit ledger. For every deposit-paid project the
  // artist owns with this producer, return how many of the prepaid
  // sessions have been consumed by confirmed bookings — and surface
  // only the ones with sessions still remaining. The booking UI uses
  // this to let the artist book additional sessions from a paid
  // package without going through Stripe again.
  //
  // Auth: every projects row scoped to (producerId, artistEmail IN
  // myEmails) — same gate as the home/music procedures.
  activePackages: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Resolve the artist's emails for this producer. Same auth-
      // boundary pattern as other artist.book.* procedures: a missing
      // clientContacts row means the artist has no relationship with
      // this producer → empty result (NOT_FOUND would over-share the
      // existence of unrelated producers).
      const contacts = await ctx.db
        .select({ email: clientContacts.email })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        );
      if (contacts.length === 0) return [];
      const myEmails = [...new Set(contacts.map((c) => c.email.toLowerCase()))];

      // One project per row, with the package label sourced from the
      // most recent confirmed booking on that project. innerJoin scopes
      // us to projects that have at least one confirmed booking — the
      // signal that the artist actually committed to the package.
      const projectRows = await ctx.db
        .select({
          id: projects.id,
          title: projects.title,
          sessionCount: projects.sessionCount,
          packageName: bookings.packageNameSnapshot,
          productId: bookings.productId,
        })
        .from(projects)
        .innerJoin(
          bookings,
          and(
            eq(bookings.projectId, projects.id),
            eq(bookings.status, "confirmed"),
          ),
        )
        .where(
          and(
            eq(projects.producerId, input.producerId),
            inArray(projects.artistEmail, myEmails),
            eq(projects.depositPaid, true),
          ),
        )
        .groupBy(projects.id, bookings.packageNameSnapshot, bookings.productId);

      // Per-project session usage. Cheap N+1 — an artist typically has
      // a handful of active packages with a single producer at any time.
      const projectsWithUsage = await Promise.all(
        projectRows.map(async (project) => {
          const rows = await ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(bookings)
            .where(
              and(
                eq(bookings.projectId, project.id),
                eq(bookings.status, "confirmed"),
              ),
            );
          const sessionsUsed = rows[0]?.count ?? 0;
          const sessionsRemaining = (project.sessionCount ?? 1) - sessionsUsed;
          return {
            projectId: project.id,
            title: project.title,
            packageName: project.packageName,
            sessionCount: project.sessionCount ?? 1,
            sessionsUsed,
            sessionsRemaining,
          };
        }),
      );

      // Only surface packages with capacity left.
      return projectsWithUsage.filter((p) => p.sessionsRemaining > 0);
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
        productId: z.string().uuid().nullable(),
        // Multi-session credit path. When present, the booking is linked
        // to an existing paid project, no productId required, and the
        // producer's approval goes straight to `confirmed` (no
        // pending_payment leg). Takes precedence over `projectId` when
        // both are passed.
        existingProjectId: z.string().uuid().optional(),
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
            inArray(bookings.status, [
              "pending_approval",
              "pending_payment",
              "confirmed",
            ]),
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

      // 4. Insert. Bookings created via the artist self-serve flow land
      //    in `pending_approval` so the producer's Calendar → Meetings →
      //    Pending approvals queue is the gate; producer-side
      //    booking.confirm is what flips it to `pending_payment` (when
      //    payment is still owed) or `confirmed` (returning artist with
      //    an existing project), and triggers auto-project creation.
      // Resolve the project link. existingProjectId (multi-session
      // credit flow) wins over legacy projectId. When linked to an
      // existing paid project, productId is irrelevant — the artist
      // is consuming a prepaid session and the producer's approval
      // path skips pending_payment because projectId is set.
      const linkedProjectId = input.existingProjectId ?? input.projectId;
      const linkedProductId = input.existingProjectId ? null : input.productId;

      const [row] = await ctx.db
        .insert(bookings)
        .values({
          producerId: input.producerId,
          artistEmail: contact.email,
          artistName: contact.name,
          startsAt,
          durationMin: input.durationMin,
          status: "pending_approval",
          statusChangedAt: new Date(),
          projectId: linkedProjectId,
          productId: linkedProductId,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return { id: row.id };
    }),

  // Bookings the producer has approved but the artist hasn't paid for
  // yet. Drives the "Session approved — payment required" banner on
  // the artist home. Joined to producers + products so the banner can
  // render the full sentence in one round-trip.
  //
  // Amount calc mirrors payment.getPaymentDetails: first paymentPlan
  // wins, split_50_50 → half, monthly → 1/N, otherwise full price.
  myPendingPayments: artistProcedure.query(async ({ ctx }) => {
    const myContacts = await ctx.db
      .select({ email: clientContacts.email })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clerkUserId, ctx.clerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      );
    if (myContacts.length === 0) return { bookings: [] };

    const myEmails = [
      ...new Set(myContacts.map((c) => c.email.toLowerCase())),
    ];

    const rows = await ctx.db
      .select({
        id: bookings.id,
        startsAt: bookings.startsAt,
        producerName: producers.displayName,
        packageName: bookings.packageNameSnapshot,
        priceCents: products.priceCents,
        currency: products.currency,
        paymentPlans: products.paymentPlans,
      })
      .from(bookings)
      .innerJoin(producers, eq(producers.id, bookings.producerId))
      .leftJoin(products, eq(products.id, bookings.productId))
      .where(
        and(
          eq(bookings.status, "pending_payment"),
          inArray(bookings.artistEmail, myEmails),
        ),
      )
      .orderBy(asc(bookings.startsAt));

    const out = rows.map((r) => {
      const price = r.priceCents ?? 0;
      const firstPlan = r.paymentPlans?.[0];
      let amountCents = price;
      if (firstPlan?.kind === "split_50_50") amountCents = Math.round(price / 2);
      else if (firstPlan?.kind === "monthly")
        amountCents = Math.round(price / firstPlan.installments);
      return {
        id: r.id,
        startsAt: r.startsAt,
        producerName: r.producerName ?? "Producer",
        packageName: r.packageName ?? "Session",
        amountCents,
        currency: r.currency ?? "ILS",
      };
    });
    return { bookings: out };
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
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            isNull(clientContacts.archivedAt),
          ),
        );

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
          volumeTiers: products.volumeTiers,
          paymentPlans: products.paymentPlans,
          position: products.position,
          producerId: products.producerId,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          // Migration 0018 — business-level VAT disclosure mode.
          // Surfaced on every product card next to the price.
          producerTaxMode: producers.taxMode,
        })
        .from(products)
        .innerJoin(producers, eq(producers.id, products.producerId))
        .where(
          and(
            inArray(products.producerId, scopedProducerIds),
            eq(products.active, true),
            isNull(products.archivedAt),
            // Per-song and flat products both list. hourly/bundle stay
            // hidden until their flows ship — keep the guard narrow so
            // the artist Store doesn't surface a product its detail
            // page can't checkout. store.checkout enforces the same
            // gate server-side so a hand-crafted productId can't
            // bypass the flat-only Stripe self-checkout path.
            inArray(products.pricingModel, ["flat", "per_song"]),
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
        volumeTiers: r.volumeTiers ?? null,
        paymentPlans: r.paymentPlans,
        producerId: r.producerId,
        producerName: r.producerName ?? "Untitled Studio",
        producerSlug: r.producerSlug,
        producerTaxMode: r.producerTaxMode,
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
          volumeTiers: products.volumeTiers,
          paymentPlans: products.paymentPlans,
          position: products.position,
          producerId: products.producerId,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          // Migration 0018 — surface for the detail page's VAT
          // footnote next to priceCents.
          producerTaxMode: producers.taxMode,
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
            isNull(clientContacts.archivedAt),
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
        volumeTiers: row.volumeTiers ?? null,
        paymentPlans: row.paymentPlans,
        producerId: row.producerId,
        producerName: row.producerName ?? "Untitled Studio",
        producerSlug: row.producerSlug,
        producerTaxMode: row.producerTaxMode,
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
        // Per-song pricing — required when the underlying product is
        // per_song, ignored otherwise. The artist-side SongCountStepper
        // computes both; we re-validate the unit price against the
        // ladder on the server so a hand-crafted payload can't lock in
        // an unauthorised rate.
        songQty: z.number().int().min(1).max(1000).optional(),
        unitPriceCents: z.number().int().min(0).max(100_000_000).optional(),
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
            isNull(clientContacts.archivedAt),
          ),
        )
        .limit(1);
      if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

      // 2b. Self-checkout guard.
      //   * flat       → must have priceCents > 0 (DB list filters
      //                  already, this is defense-in-depth).
      //   * per_song   → must arrive with songQty + unitPriceCents;
      //                  the server uses them to compute the locked-in
      //                  total. The unit price is validated against
      //                  the product's volumeTiers below so a
      //                  hand-crafted payload can't lock in a price
      //                  the producer didn't authorise.
      //   * hourly /
      //     bundle     → no UI for collecting qty/duration yet, so
      //                  reject loudly. (Legacy public
      //                  /p/[slug]/book flow was removed in Story 03
      //                  per PRD §6.6.)
      if (prod.pricingModel === "flat" && prod.priceCents <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This product isn't available for self-checkout yet — contact the producer to book it directly.",
        });
      }
      if (
        prod.pricingModel === "hourly" ||
        prod.pricingModel === "bundle"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This product isn't available for self-checkout yet — contact the producer to book it directly.",
        });
      }
      if (prod.pricingModel === "per_song") {
        if (input.songQty == null || input.unitPriceCents == null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Per-song products need a song count — pick one before continuing.",
          });
        }
        // Validate the locked-in unit price against the product's
        // volumeTiers ladder. The artist's stepper computes
        // unitPriceFor(qty, tiers) client-side; we re-run the same
        // math server-side so a tampered payload can't lock in a
        // cheaper-than-offered rate.
        const tiers = prod.volumeTiers ?? [];
        const { unitPriceFor } = await import("~/lib/pricing");
        const serverUnit = unitPriceFor(input.songQty, tiers);
        if (serverUnit !== input.unitPriceCents) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pricing changed — refresh the page and try again.",
          });
        }
      }

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
      // Per-song products: the locked-in total is songQty *
      // unitPriceCents. Flat products keep using the product's
      // canonical priceCents. The guard above already enforced that
      // per_song arrives with both fields present.
      const effectivePriceCents =
        prod.pricingModel === "per_song" &&
        input.songQty != null &&
        input.unitPriceCents != null
          ? input.songQty * input.unitPriceCents
          : prod.priceCents;
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
        priceCents: effectivePriceCents,
        // Per-song denormalisation — undefined on flat checkouts
        // (the helper's args are optional with exactOptionalPropertyTypes).
        ...(prod.pricingModel === "per_song" && input.songQty != null
          ? { songQty: input.songQty }
          : {}),
        ...(prod.pricingModel === "per_song" && input.unitPriceCents != null
          ? { unitPriceCents: input.unitPriceCents }
          : {}),
        idempotencyKey,
        metadata: { source: "artist_store" },
        // Keep artists inside the artist app after Stripe. The helper's
        // default success/cancel URLs now point to /join/<slug> (the
        // new artist funnel per PRD §6.6) — correct for anonymous
        // booking initiated from /join, wrong for this signed-in
        // store flow. On success we deep-link to /artist with a query
        // flag so the Home tab can render a "thanks, you're set!"
        // toast (UI hook-up is a follow-up; for now the redirect alone
        // is enough). On cancel we return to the product detail so the
        // artist can pick a different plan without losing context.
        successUrl: `${getSiteUrl()}/artist?checkoutSuccess=1`,
        cancelUrl: `${getSiteUrl()}/artist/store/${prod.id}`,
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
  volumeTiers: { minQty: number; pricePerUnitCents: number }[] | null;
  paymentPlans: PaymentPlan[];
  producerId: string;
  producerName: string;
  producerSlug: string;
  // Producer's business-level VAT disclosure mode. See ~/lib/tax-mode.
  // String on the wire (free-text column) — the UI narrows via
  // isTaxMode() or hands it straight to taxModeFootnote() which
  // defaults unknown values to no footnote.
  producerTaxMode: string;
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
      .where(
        and(
          eq(clientContacts.clerkUserId, ctx.clerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      );

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
      .where(
        and(
          eq(clientContacts.clerkUserId, ctx.clerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      );

    if (myContacts.length === 0) {
      return {
        nextSession: null,
        upcomingSessions: [],
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
      upcomingSessionRows,
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

      // (2b) All upcoming confirmed sessions (including the one above).
      // The UI skips the first to avoid double-rendering the next
      // session, which already has its own dedicated card.
      ctx.db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          producerName: producers.displayName,
          packageName: bookings.packageNameSnapshot,
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
        .limit(10),

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
      upcomingSessions: upcomingSessionRows.map((s) => ({
        id: s.id,
        startsAt: s.startsAt,
        durationMin: s.durationMin,
        producerName: s.producerName ?? "Producer",
        packageName: s.packageName,
      })),
      latestMix,
      outstandingBalance,
      activity: cappedActivity,
    };
  }),

  // Tranzila success page lookup. Returns the artist's most recently
  // confirmed booking within the last 10 minutes — the success page has
  // no querystring to identify the booking (Tranzila strips arbitrary
  // params), so we infer it from the freshly-confirmed booking attached
  // to one of this artist's emails. Returns null if nothing recent;
  // the success page renders a generic celebration in that case.
  //
  // Auth boundary: `clientContacts.clerkUserId = ctx.clerkUserId` is the
  // gate — we only consider bookings whose artistEmail matches one of
  // this user's contact emails. Cross-tenant leakage is impossible
  // because both producerId and email filters live on the same row.
  //
  // 10-minute window keeps an old confirmed booking from accidentally
  // re-rendering if the artist navigates to /artist/payment/success
  // long after the fact.
  recentConfirmedBooking: artistProcedure.query(async ({ ctx }) => {
    const myContacts = await ctx.db
      .select({ email: clientContacts.email })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clerkUserId, ctx.clerkUserId),
          isNull(clientContacts.archivedAt),
        ),
      );
    if (myContacts.length === 0) return null;
    const myEmails = [
      ...new Set(myContacts.map((c) => c.email.toLowerCase())),
    ];

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const rows = await ctx.db
      .select({
        id: bookings.id,
        startsAt: bookings.startsAt,
        durationMin: bookings.durationMin,
        packageNameSnapshot: bookings.packageNameSnapshot,
        tranzilaConfirmationCode: bookings.tranzilaConfirmationCode,
        producerName: producers.displayName,
      })
      .from(bookings)
      .innerJoin(producers, eq(producers.id, bookings.producerId))
      .where(
        and(
          eq(bookings.status, "confirmed"),
          inArray(bookings.artistEmail, myEmails),
          gte(bookings.statusChangedAt, tenMinutesAgo),
        ),
      )
      .orderBy(desc(bookings.statusChangedAt))
      .limit(1);
    return rows[0] ?? null;
  }),

  // Soft-disconnect the signed-in artist from one of their studios.
  // Sets clientContacts.archivedAt so every artist-side read filters
  // the row out (the row itself stays for the producer's CRM history).
  //
  // Blocked when the artist has any active booking (pending_approval,
  // pending_payment, or confirmed) with this producer. The check
  // filters bookings.artistEmail against the artist's own contact
  // emails — joining bookings → clientContacts on producerId alone
  // would surface OTHER artists' bookings and falsely block the
  // disconnect.
  disconnectProducer: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const myContacts = await ctx.db
        .select({ email: clientContacts.email })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        );
      if (myContacts.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const myEmails = [...new Set(myContacts.map((c) => c.email.toLowerCase()))];

      const activeBookings = await ctx.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, input.producerId),
            inArray(bookings.artistEmail, myEmails),
            inArray(bookings.status, [
              "pending_approval",
              "pending_payment",
              "confirmed",
            ]),
          ),
        )
        .limit(1);
      if (activeBookings.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot disconnect — you have active bookings with this producer.",
        });
      }

      await ctx.db
        .update(clientContacts)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        );

      return { ok: true as const };
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

