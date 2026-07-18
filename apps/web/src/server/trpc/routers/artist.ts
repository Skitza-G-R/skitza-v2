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
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  producers,
  products,
  projects,
  projectTracks,
  purchases,
  purchaseSessionAllowances,
  sql,
  trackComments,
  trackVersions,
  versionApprovalEvents,
} from "@skitza/db";
import type { Db, PaymentPlan, Project, PurchaseCommercialSnapshot } from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { after } from "next/server";
import { z } from "zod";
import { router } from "../init";
import { artistProcedure } from "../artist-procedure";
import { artistPurchaseRouter } from "./purchase";
import { groupStudiosForArtist } from "~/server/artist/identity";
import {
  activeArtistClientOwner,
  assertArtistMusicProjectAvailable,
  resolveProjectOwnership,
} from "~/server/artist/access";
import { SITE_URL, sendNewCommentFromArtistEmail } from "~/server/email/send";
import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import { emitBookingRequested, emitCommentCreated } from "~/server/notifications/emit";
import {
  assertSessionBookingAllowed,
  SessionBookingDomainError,
  sessionUseConsumesAllowance,
} from "~/server/domain/session-booking/service";
import { assertWritableCommentTarget, CommentDomainError } from "~/server/domain/comments/service";

function purchaseProductName(
  snapshot: PurchaseCommercialSnapshot | null,
  fallback: string,
): string {
  const name = snapshot?.productOrOfferName.trim();
  return name ? name : fallback;
}

type PendingBookingPaymentCompatibility = {
  id: string;
  startsAt: Date;
  producerName: string;
  packageName: string;
  amountCents: number;
  currency: string;
  plan: "50-50" | "monthly" | "upfront";
  planLabel: string;
};

async function productCommercialTermsColumnsAvailable(db: Pick<Db, "execute">): Promise<boolean> {
  const result = await db.execute<{ columnCount: number }>(sql`
    select count(*)::int as "columnCount"
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'products'
      and column_name in ('royalty_terms', 'agreement_text')
  `);
  return (result.rows[0]?.columnCount ?? 0) === 2;
}

function mapCommentDomainError(error: unknown): never {
  if (!(error instanceof CommentDomainError)) throw error;
  if (error.code === "INACTIVE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw new TRPCError({ code: "NOT_FOUND" });
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
    // Fan out: project metadata + per-project track stats. Each query
    // joins the signed-in artist's exact active producer/email pair.
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
          projectLifecycleStatus: projects.lifecycleStatus,
          producerId: projects.producerId,
          producerName: producers.displayName,
          producerSlug: producers.slug,
        })
        .from(projects)
        .innerJoin(producers, eq(producers.id, projects.producerId))
        .innerJoin(
          clientContacts,
          activeArtistClientOwner(ctx.clerkUserId, {
            producerId: projects.producerId,
            clientContactId: projects.clientContactId,
          }),
        )
        .where(ne(projects.lifecycleStatus, "waiting_for_payment")),

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
        .innerJoin(
          clientContacts,
          activeArtistClientOwner(ctx.clerkUserId, {
            producerId: projects.producerId,
            clientContactId: projects.clientContactId,
          }),
        )
        .leftJoin(
          trackVersions,
          and(
            eq(trackVersions.trackId, projectTracks.id),
            isNotNull(trackVersions.audioUrl),
            isNull(trackVersions.audioDeletedAt),
          ),
        )
        .where(ne(projects.lifecycleStatus, "waiting_for_payment")),
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
        (!s.latestUploadedAt || uploadedAt.getTime() > s.latestUploadedAt.getTime())
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
        projectLifecycleStatus: p.projectLifecycleStatus,
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
        return b.latestTrackUploadedAt.getTime() - a.latestTrackUploadedAt.getTime();
      }
      if (a.latestTrackUploadedAt) return -1; // a has date, b is null → a first
      if (b.latestTrackUploadedAt) return 1; // b has date, a is null → b first
      return 0;
    });

    return { projects: merged.slice(0, 50) };
  }),

  // Flat per-track list across every project this artist is part of.
  // Mirrors the shape `producer.music.list` returns so the L1 Library
  // screen (extracted from the producer side) renders identically on
  // the artist side. One row per TRACK — the latest version per track
  // — with the upload timestamp used to sort newest-first.
  //
  // Auth boundary: join each project to the signed-in artist's exact
  // active producer/email relationship.
  //
  // `clientName` on the wire is overloaded: on the producer side it's
  // the artist's name (the project's `clientName` column). On the
  // artist side there is no artist-of-the-artist, so we substitute the
  // producer's display name. The shared component reads it as a
  // generic "partner label" and renders it identically.
  list: artistProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        versionId: trackVersions.id,
        versionLabel: trackVersions.label,
        audioUrl: trackVersions.audioUrl,
        durationMs: trackVersions.durationMs,
        uploadedAt: trackVersions.uploadedAt,
        trackId: projectTracks.id,
        trackTitle: projectTracks.title,
        trackArtist: projectTracks.artist,
        projectId: projects.id,
        projectTitle: projects.title,
        projectLifecycleStatus: projects.lifecycleStatus,
        producerName: producers.displayName,
      })
      .from(trackVersions)
      .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
      .innerJoin(projects, eq(projects.id, projectTracks.projectId))
      .innerJoin(
        clientContacts,
        activeArtistClientOwner(ctx.clerkUserId, {
          producerId: projects.producerId,
          clientContactId: projects.clientContactId,
        }),
      )
      .innerJoin(producers, eq(producers.id, projects.producerId))
      .where(
        and(
          ne(projects.lifecycleStatus, "waiting_for_payment"),
          isNotNull(trackVersions.audioUrl),
          isNull(trackVersions.audioDeletedAt),
        ),
      )
      .orderBy(desc(trackVersions.uploadedAt));

    // Collapse versions → tracks, keeping the newest per track.
    const byTrack = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!byTrack.has(r.trackId)) byTrack.set(r.trackId, r);
    }
    const trackList = Array.from(byTrack.values()).slice(0, 100);

    // Per-version unread-from-producer count — single IN query.
    // Inverse of the producer side: we count fromProducer = true
    // comments (producer talking) that aren't yet resolved.
    const versionIds = trackList.map((t) => t.versionId);
    const noteRows = versionIds.length
      ? await ctx.db
          .select({ versionId: trackComments.versionId })
          .from(trackComments)
          .where(
            and(
              inArray(trackComments.versionId, versionIds),
              eq(trackComments.fromProducer, true),
              isNull(trackComments.resolvedAt),
            ),
          )
      : [];
    const notesByVersion = new Map<string, number>();
    for (const n of noteRows) {
      notesByVersion.set(n.versionId, (notesByVersion.get(n.versionId) ?? 0) + 1);
    }

    const tracks = trackList.map((r) => ({
      id: r.versionId,
      trackId: r.trackId,
      trackTitle: r.trackTitle,
      trackArtist: r.trackArtist,
      label: r.versionLabel,
      projectId: r.projectId,
      projectTitle: r.projectTitle,
      projectLifecycleStatus: r.projectLifecycleStatus,
      // See the procedure header: this is the producer's display name
      // surfaced under the producer's `clientName` field on the wire,
      // so the shared component can render it without conditional logic.
      clientName: r.producerName,
      uploadedAt: r.uploadedAt,
      audioUrl: r.audioUrl,
      durationMs: r.durationMs,
      unreadComments: notesByVersion.get(r.versionId) ?? 0,
      // Schema has no play counter yet — same placeholder the producer
      // side returns so both libraries render em-dash here.
      plays: 0,
    }));

    return { tracks };
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
      // (0) Auth gate — same NOT_FOUND-on-miss ownership resolver the
      // L3 mutations use. Returns the project row when the signed-in
      // artist is the project's client_contacts owner.
      const { project } = await resolveProjectOwnership(ctx.db, ctx.clerkUserId, input.projectId);
      assertArtistMusicProjectAvailable(project.lifecycleStatus);

      // (1) Producer display name. We surface this BOTH as the
      // overloaded `clientName` (the shared ProjectPage reads it as
      // "the other party on this project") AND as `producerName`
      // (kept for the artist-only sessions panel + breadcrumb work).
      // Defensive fallback because nothing prevents an orphan row.
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, project.producerId))
        .limit(1);
      const producerName = producerRow?.displayName ?? "Producer";

      // (2) Every version under this project, newest first. Same
      // collapsing trick the producer side uses (Map keyed by trackId,
      // first entry wins → the latest version per track).
      const versionRows = await ctx.db
        .select({
          versionId: trackVersions.id,
          versionLabel: trackVersions.label,
          audioUrl: trackVersions.audioUrl,
          durationMs: trackVersions.durationMs,
          uploadedAt: trackVersions.uploadedAt,
          trackId: projectTracks.id,
          trackTitle: projectTracks.title,
          trackArtist: projectTracks.artist,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .where(
          and(
            eq(projectTracks.projectId, project.id),
            isNotNull(trackVersions.audioUrl),
            isNull(trackVersions.audioDeletedAt),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt));

      const byTrack = new Map<string, (typeof versionRows)[number]>();
      for (const v of versionRows) {
        if (!byTrack.has(v.trackId)) byTrack.set(v.trackId, v);
      }
      const trackList = Array.from(byTrack.values());

      // (3) Unread-from-producer count per latest-version. Inverse of
      // the producer's filter — we count `fromProducer = true` (the
      // producer talking) that aren't yet resolved. Same single-IN
      // shape so a project with N tracks costs one query.
      const versionIds = trackList.map((t) => t.versionId);
      const noteRows = versionIds.length
        ? await ctx.db
            .select({ versionId: trackComments.versionId })
            .from(trackComments)
            .where(
              and(
                inArray(trackComments.versionId, versionIds),
                eq(trackComments.fromProducer, true),
                isNull(trackComments.resolvedAt),
              ),
            )
        : [];
      const notesByVersion = new Map<string, number>();
      for (const n of noteRows) {
        notesByVersion.set(n.versionId, (notesByVersion.get(n.versionId) ?? 0) + 1);
      }

      // (4) Producer-shape flat tracks. Matches ProjectPageTrack on
      // the shared component, so the artist page.tsx can map this
      // directly (Date → ISO at the RSC → client boundary).
      const tracks = trackList.map((r) => ({
        id: r.versionId,
        trackId: r.trackId,
        title: r.trackTitle,
        artist: r.trackArtist,
        versionLabel: r.versionLabel,
        audioUrl: r.audioUrl,
        durationMs: r.durationMs,
        uploadedAt: r.uploadedAt,
        unreadComments: notesByVersion.get(r.versionId) ?? 0,
        // Schema has no play counter yet — em-dash placeholder, same
        // as producer.music.project.
        plays: 0,
      }));

      // (5) Sessions tied to this project (artist-specific extra; the
      // producer L2 doesn't render this). Unchanged from the prior
      // shape — pending_approval / pending_payment / confirmed only.
      const sessionRows = await ctx.db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          status: bookings.status,
          commercialSnapshot: purchases.commercialSnapshot,
        })
        .from(bookings)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
            eq(purchases.clientContactId, project.clientContactId),
          ),
        )
        .where(
          and(
            eq(bookings.projectId, project.id),
            inArray(bookings.status, ["pending_approval", "confirmed"]),
          ),
        )
        .orderBy(asc(bookings.startsAt));

      return {
        project: {
          id: project.id,
          title: project.title,
          // `clientName` overloaded with the producer's display name
          // (see procedure header on artist.music.list) so the shared
          // ProjectPage renders without conditional logic.
          clientName: producerName,
          createdAt: project.createdAt,
          lifecycleStatus: project.lifecycleStatus,
          // Artist-specific extras kept on the wire — used by the
          // sessions panel + the breadcrumb topbar publisher.
          producerId: project.producerId,
          producerName,
        },
        tracks,
        sessions: sessionRows.map((s) => ({
          id: s.id,
          startsAt: s.startsAt,
          durationMin: s.durationMin,
          status: s.status,
          packageName: purchaseProductName(s.commercialSnapshot, project.title),
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
      // Discover the lock key without trusting it as the write boundary.
      // The transaction below re-reads and locks the whole chain.
      const [discovered] = await ctx.db
        .select({
          versionId: trackVersions.id,
          trackId: projectTracks.id,
          projectId: projects.id,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(eq(trackVersions.id, input.trackVersionId))
        .limit(1);
      if (!discovered) throw new TRPCError({ code: "NOT_FOUND" });

      let saved: {
        row: typeof trackComments.$inferSelect;
        project: Pick<typeof projects.$inferSelect, "id" | "producerId">;
        track: Pick<typeof projectTracks.$inferSelect, "title">;
        contact: Pick<typeof clientContacts.$inferSelect, "name" | "email">;
      };
      try {
        saved = await ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${discovered.projectId}, 0))`,
          );
          const [project] = await tx
            .select({
              id: projects.id,
              producerId: projects.producerId,
              clientContactId: projects.clientContactId,
              lifecycleStatus: projects.lifecycleStatus,
            })
            .from(projects)
            .where(eq(projects.id, discovered.projectId))
            .limit(1)
            .for("update");
          const [track] = await tx
            .select({
              id: projectTracks.id,
              projectId: projectTracks.projectId,
              title: projectTracks.title,
              archivedAt: projectTracks.archivedAt,
            })
            .from(projectTracks)
            .where(eq(projectTracks.id, discovered.trackId))
            .limit(1)
            .for("update");
          const [version] = await tx
            .select({ id: trackVersions.id, trackId: trackVersions.trackId })
            .from(trackVersions)
            .where(eq(trackVersions.id, input.trackVersionId))
            .limit(1)
            .for("update");

          if (!project) throw new CommentDomainError("NOT_FOUND", "Project not found");
          const [contact] = await tx
            .select({
              name: clientContacts.name,
              email: clientContacts.email,
            })
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.clerkUserId, ctx.clerkUserId),
                eq(clientContacts.id, project.clientContactId),
                eq(clientContacts.producerId, project.producerId),
                isNull(clientContacts.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!contact) throw new CommentDomainError("NOT_FOUND", "Project not found");
          if (!track || !version) {
            throw new CommentDomainError("NOT_FOUND", "The comment target was not found");
          }

          assertWritableCommentTarget(
            {
              versionId: version.id,
              versionTrackId: version.trackId,
              trackId: track.id,
              trackProjectId: track.projectId,
              trackArchivedAt: track.archivedAt,
              projectId: project.id,
              projectLifecycleStatus: project.lifecycleStatus,
            },
            {
              versionId: input.trackVersionId,
              trackId: discovered.trackId,
              projectId: discovered.projectId,
            },
          );

          const [row] = await tx
            .insert(trackComments)
            .values({
              versionId: input.trackVersionId,
              producerId: project.producerId,
              authorName: contact.name,
              authorEmail: contact.email,
              body: input.body,
              timestampMs: input.timeMs,
              fromProducer: false,
            })
            .returning();
          if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          return {
            row,
            project: { id: project.id, producerId: project.producerId },
            track: { title: track.title },
            contact,
          };
        });
      } catch (error) {
        mapCommentDomainError(error);
      }
      const { row, project, track, contact } = saved;

      // The bell is the producer's event-notification surface. Keep this
      // side effect outside the primary insert contract: a notification
      // failure must not discard the artist's saved comment.
      try {
        await emitCommentCreated(ctx.db, {
          producerId: project.producerId,
          commentId: row.id,
          trackVersionId: input.trackVersionId,
          projectId: project.id,
          authorName: contact.name,
          preview: input.body,
        });
      } catch (error) {
        console.warn("[notify] comment-created failed", error);
      }

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

  // L3 song page detail — single track with full version stack +
  // timestamped comments. Mirrors `producer.music.detail`'s shape so
  // the shared SongPage component renders identically. Resolves by
  // VERSION id (the same identifier L1 + L2 rows use) so the route
  // /artist/music/song/<versionId> deep-links cleanly.
  //
  // Auth gate (two-step, same pattern as `project`):
  //   1. Resolve version → track → projectId.
  //   2. resolveProjectOwnership(projectId) — NOT_FOUND on miss so we
  //      don't differentiate "doesn't exist" from "not yours".
  //
  // `clientName` on the wire is overloaded with the producer's display
  // name (same trick as artist.music.list + artist.music.project) so
  // the shared SongPage's breadcrumb middle crumb reads correctly
  // without conditional logic.
  detail: artistProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // (1) Resolve version → projectId.
      const [head] = await ctx.db
        .select({
          versionId: trackVersions.id,
          trackId: projectTracks.id,
          trackTitle: projectTracks.title,
          trackArtist: projectTracks.artist,
          projectId: projects.id,
          projectTitle: projects.title,
          projectProducerId: projects.producerId,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(trackVersions.id, input.versionId),
            or(isNotNull(trackVersions.audioUrl), isNotNull(trackVersions.audioDeletedAt)),
          ),
        )
        .limit(1);
      if (!head) throw new TRPCError({ code: "NOT_FOUND" });

      // (2) Ownership check — same NOT_FOUND-on-miss helper that L2
      // and addComment use. We don't bind the helper's `project`
      // because we already have the data we need from the join above.
      const { project: ownedProject } = await resolveProjectOwnership(
        ctx.db,
        ctx.clerkUserId,
        head.projectId,
      );
      assertArtistMusicProjectAvailable(ownedProject.lifecycleStatus);

      // (3) Producer display name for the overloaded `clientName`
      // field. Defensive fallback (orphan FK shouldn't happen but).
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, head.projectProducerId))
        .limit(1);
      const producerName = producerRow?.displayName ?? "Producer";

      // (4) Full version stack desc by uploadedAt (newest first =
      // "v3 · current" pill position in the L3 UI). Includes
      // approvedAt + peaks — peaks ride down with the page payload
      // so Waveform50 renders the real envelope on first frame.
      const versionRows = await ctx.db
        .select({
          id: trackVersions.id,
          label: trackVersions.label,
          audioUrl: trackVersions.audioUrl,
          durationMs: trackVersions.durationMs,
          uploadedAt: trackVersions.uploadedAt,
          peaks: trackVersions.peaks,
        })
        .from(trackVersions)
        .where(
          and(
            eq(trackVersions.trackId, head.trackId),
            or(isNotNull(trackVersions.audioUrl), isNotNull(trackVersions.audioDeletedAt)),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt));

      const approvalRows =
        versionRows.length === 0
          ? []
          : await ctx.db
              .select({
                versionId: versionApprovalEvents.versionId,
                action: versionApprovalEvents.action,
                createdAt: versionApprovalEvents.createdAt,
              })
              .from(versionApprovalEvents)
              .where(
                and(
                  inArray(
                    versionApprovalEvents.versionId,
                    versionRows.map((version) => version.id),
                  ),
                  eq(versionApprovalEvents.producerId, ownedProject.producerId),
                  eq(versionApprovalEvents.clientContactId, ownedProject.clientContactId),
                ),
              )
              .orderBy(desc(versionApprovalEvents.createdAt));
      const latestApprovalByVersion = new Map<string, (typeof approvalRows)[number]>();
      for (const event of approvalRows) {
        if (!latestApprovalByVersion.has(event.versionId)) {
          latestApprovalByVersion.set(event.versionId, event);
        }
      }
      const versions = versionRows.map((version) => {
        const event = latestApprovalByVersion.get(version.id);
        return {
          ...version,
          approvedAt: event?.action === "approved" ? event.createdAt : null,
        };
      });

      // (5) Comments across all versions of this track, asc by
      // timestampMs so the thread reads in track order.
      const versionIds = versions.map((v) => v.id);
      const comments = versionIds.length
        ? await ctx.db
            .select({
              id: trackComments.id,
              versionId: trackComments.versionId,
              timeMs: trackComments.timestampMs,
              body: trackComments.body,
              fromProducer: trackComments.fromProducer,
              authorName: trackComments.authorName,
              createdAt: trackComments.createdAt,
              resolvedAt: trackComments.resolvedAt,
            })
            .from(trackComments)
            .where(inArray(trackComments.versionId, versionIds))
            .orderBy(asc(trackComments.timestampMs))
        : [];

      return {
        track: {
          id: head.trackId,
          title: head.trackTitle,
          artist: head.trackArtist,
          projectId: head.projectId,
          projectTitle: head.projectTitle,
          clientName: producerName,
          projectLifecycleStatus: ownedProject.lifecycleStatus,
        },
        versions,
        comments,
        selectedVersionId: input.versionId,
      };
    }),

  // Resolve / re-open a timestamped comment on the artist's project.
  // Producer-side has `project.resolveComment` (gated on producerId);
  // mirrored here for the artist so the shared SongPage's Resolve /
  // Reopen buttons work on /artist/music/song/<versionId>.
  //
  // Auth: walk comment → version → track → projectId, then
  // resolveProjectOwnership to verify the signed-in artist owns the
  // parent project via client_contacts. NOT_FOUND on any miss.
  resolveComment: artistProcedure
    .input(z.object({ id: z.string().uuid(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [c] = await ctx.db
        .select({ id: trackComments.id, versionId: trackComments.versionId })
        .from(trackComments)
        .where(eq(trackComments.id, input.id))
        .limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      const [v] = await ctx.db
        .select({ trackId: trackVersions.trackId })
        .from(trackVersions)
        .where(eq(trackVersions.id, c.versionId))
        .limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });
      const [t] = await ctx.db
        .select({ projectId: projectTracks.projectId })
        .from(projectTracks)
        .where(eq(projectTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      await resolveProjectOwnership(ctx.db, ctx.clerkUserId, t.projectId);

      await ctx.db
        .update(trackComments)
        .set({ resolvedAt: input.resolved ? new Date() : null })
        .where(eq(trackComments.id, input.id));
      return { ok: true as const };
    }),
});

// Per-project row shape returned by artist.music.projects.
export type MusicProjectRow = {
  projectId: string;
  title: string;
  projectLifecycleStatus: Project["lifecycleStatus"];
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
  const [contact] = await resolveClientContacts(db, clerkUserId, producerId);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });
  return contact;
}

async function resolveClientContacts(
  db: Db,
  clerkUserId: string,
  producerId: string,
): Promise<(typeof clientContacts.$inferSelect)[]> {
  const contacts = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clerkUserId, clerkUserId),
        eq(clientContacts.producerId, producerId),
        isNull(clientContacts.archivedAt),
      ),
    );
  if (contacts.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
  return contacts;
}

function mapSessionBookingDomainError(error: unknown): never {
  if (!(error instanceof SessionBookingDomainError)) throw error;
  if (error.code === "ALLOWANCE_EXHAUSTED") {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (
    error.code === "PURCHASE_INACTIVE" ||
    error.code === "PROJECT_INACTIVE" ||
    error.code === "ALLOWANCE_CLOSED"
  ) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
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
      await resolveClientContact(ctx.db, ctx.clerkUserId, input.producerId);

      // 2. Build the 14-day window. Dates are surfaced as "YYYY-MM-DD"
      //    (no TZ) — the UI renders them in the device's locale. Using
      //    UTC calendar math here is a simplification: the producer's
      //    timezone doesn't shift day boundaries in the strip. A
      //    follow-up would plumb `producers.timezone` through.
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
              inArray(bookings.status, ["pending_approval", "confirmed"]),
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
          const blockStart = new Date(dayUtc.getTime() + b.startMin * 60 * 1000);
          const blockEnd = new Date(dayUtc.getTime() + b.endMin * 60 * 1000);
          const conflict = bookingRows.some((bk) => {
            const bkEnd = new Date(bk.startsAt.getTime() + bk.durationMin * 60 * 1000);
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

  // Active purchase-owned session allowances. Stable client-contact IDs,
  // not email snapshots, own both the project and the purchase.
  activePackages: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const contacts = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.clerkUserId, ctx.clerkUserId),
            eq(clientContacts.producerId, input.producerId),
            isNull(clientContacts.archivedAt),
          ),
        );
      if (contacts.length === 0) return [];
      const myContactIds = contacts.map((contact) => contact.id);

      const allowanceRows = await ctx.db
        .select({
          purchaseId: purchases.id,
          projectId: projects.id,
          title: projects.title,
          commercialSnapshot: purchases.commercialSnapshot,
          allowanceId: purchaseSessionAllowances.id,
          allowanceKind: purchaseSessionAllowances.kind,
          sessionLimit: purchaseSessionAllowances.sessionLimit,
          durationMin: purchaseSessionAllowances.durationMin,
        })
        .from(purchases)
        .innerJoin(
          projects,
          and(
            eq(projects.id, purchases.projectId),
            eq(projects.producerId, purchases.producerId),
            eq(projects.clientContactId, purchases.clientContactId),
          ),
        )
        .innerJoin(
          purchaseSessionAllowances,
          and(
            eq(purchaseSessionAllowances.purchaseId, purchases.id),
            eq(purchaseSessionAllowances.producerId, purchases.producerId),
          ),
        )
        .where(
          and(
            eq(purchases.producerId, input.producerId),
            inArray(purchases.clientContactId, myContactIds),
            eq(purchases.lifecycleStatus, "active"),
            eq(projects.lifecycleStatus, "active"),
            isNull(purchaseSessionAllowances.closedAt),
          ),
        );

      const allowancesWithUsage = await Promise.all(
        allowanceRows.map(async (allowance) => {
          const rows = await ctx.db
            .select({ outcome: bookings.outcome })
            .from(bookings)
            .where(
              and(
                eq(bookings.purchaseId, allowance.purchaseId),
                eq(bookings.sessionAllowanceId, allowance.allowanceId),
                eq(bookings.producerId, input.producerId),
              ),
            );
          const sessionsUsed = rows.filter((row) =>
            sessionUseConsumesAllowance(row.outcome),
          ).length;
          const unlimitedSessions = allowance.allowanceKind === "unlimited";
          const sessionCount = unlimitedSessions ? 0 : (allowance.sessionLimit ?? 0);
          const sessionsRemaining = unlimitedSessions ? 0 : sessionCount - sessionsUsed;
          return {
            purchaseId: allowance.purchaseId,
            sessionAllowanceId: allowance.allowanceId,
            projectId: allowance.projectId,
            title: allowance.title,
            packageName: purchaseProductName(allowance.commercialSnapshot, allowance.title),
            sessionCount,
            sessionsUsed,
            sessionsRemaining,
            unlimitedSessions,
            durationMin: allowance.durationMin,
          };
        }),
      );

      return allowancesWithUsage.filter(
        (row) => row.unlimitedSessions || row.sessionsRemaining > 0,
      );
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
        existingProjectId: z.string().uuid().optional(),
        purchaseId: z.string().uuid(),
        sessionAllowanceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const targetProjectId = input.existingProjectId ?? input.projectId;
      if (!targetProjectId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A purchased session allowance is required.",
        });
      }

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
      const startsAt = new Date(Date.UTC(year, month - 1, day, 0, 0) + input.startMin * 60 * 1000);

      const endsAt = new Date(startsAt.getTime() + input.durationMin * 60 * 1000);
      const booking = await ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.producerId}, 0))`,
        );

        const candidates = await tx
          .select({
            purchase: purchases,
            project: projects,
            allowance: purchaseSessionAllowances,
            contact: clientContacts,
          })
          .from(purchases)
          .innerJoin(
            projects,
            and(
              eq(projects.id, purchases.projectId),
              eq(projects.producerId, purchases.producerId),
              eq(projects.clientContactId, purchases.clientContactId),
            ),
          )
          .innerJoin(
            purchaseSessionAllowances,
            and(
              eq(purchaseSessionAllowances.purchaseId, purchases.id),
              eq(purchaseSessionAllowances.producerId, purchases.producerId),
            ),
          )
          .innerJoin(
            clientContacts,
            and(
              eq(clientContacts.id, purchases.clientContactId),
              eq(clientContacts.producerId, purchases.producerId),
              eq(clientContacts.clerkUserId, ctx.clerkUserId),
              isNull(clientContacts.archivedAt),
            ),
          )
          .where(
            and(
              eq(purchases.projectId, targetProjectId),
              eq(purchases.producerId, input.producerId),
              eq(purchases.id, input.purchaseId),
              eq(purchaseSessionAllowances.id, input.sessionAllowanceId),
            ),
          )
          .for("update");
        if (candidates.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (candidates.length > 1) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Choose the exact purchased session allowance.",
          });
        }
        const candidate = candidates[0];
        if (!candidate) throw new TRPCError({ code: "NOT_FOUND" });

        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${candidate.allowance.id}, 0))`,
        );
        const bookingContact = candidate.contact;

        const existingUses = await tx
          .select({ outcome: bookings.outcome })
          .from(bookings)
          .where(
            and(
              eq(bookings.purchaseId, candidate.purchase.id),
              eq(bookings.sessionAllowanceId, candidate.allowance.id),
              eq(bookings.producerId, input.producerId),
            ),
          );
        try {
          assertSessionBookingAllowed({
            purchaseLifecycleStatus: candidate.purchase.lifecycleStatus,
            projectLifecycleStatus: candidate.project.lifecycleStatus,
            allowance: candidate.allowance,
            existingOutcomes: existingUses.map((use) => use.outcome),
            requestedDurationMin: input.durationMin,
            startsAt,
            now: new Date(),
          });
        } catch (error) {
          mapSessionBookingDomainError(error);
        }

        // Pull every active booking in a wide (±24h) window, then do the
        // precise overlap test in JS while the producer lock is held.
        const slotCandidates = await tx
          .select({
            startsAt: bookings.startsAt,
            durationMin: bookings.durationMin,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.producerId, input.producerId),
              inArray(bookings.status, ["pending_approval", "confirmed"]),
              gte(bookings.startsAt, new Date(startsAt.getTime() - 24 * 60 * 60 * 1000)),
              lte(bookings.startsAt, endsAt),
            ),
          );
        const overlap = slotCandidates.some((bk) => {
          const bkEnd = new Date(bk.startsAt.getTime() + bk.durationMin * 60 * 1000);
          return bk.startsAt < endsAt && startsAt < bkEnd;
        });
        if (overlap) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "slot no longer available",
          });
        }

        const now = new Date();
        const [row] = await tx
          .insert(bookings)
          .values({
            producerId: input.producerId,
            artistEmail: bookingContact.email,
            artistName: bookingContact.name,
            startsAt,
            durationMin: input.durationMin,
            status: "pending_approval",
            statusChangedAt: now,
            projectId: candidate.project.id,
            purchaseId: candidate.purchase.id,
            sessionAllowanceId: candidate.allowance.id,
          })
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        return {
          id: row.id,
          artistName: bookingContact.name,
          artistEmail: bookingContact.email,
        };
      });

      // The top-right bell is the producer's single notification entry
      // point. Emit the verified booking event after the primary insert;
      // a notification failure must never roll back the artist's booking.
      try {
        await emitBookingRequested(ctx.db, {
          producerId: input.producerId,
          bookingId: booking.id,
          artistName: booking.artistName,
          artistEmail: booking.artistEmail,
          when: startsAt,
        });
      } catch (error) {
        console.warn("[notify] booking-requested failed", error);
      }

      return { id: booking.id };
    }),

  // Payment belongs to Purchase, never to Booking. Keep the old read shape
  // empty until the purchase-installment artist surface lands.
  myPendingPayments: artistProcedure.query(
    (): {
      available: false;
      bookings: PendingBookingPaymentCompatibility[];
    } => ({ available: false, bookings: [] }),
  ),
});

// ─── artist.store sub-router ─────────────────────────────────────────
// Browse products from any of the artist's studios without leaving the
// artist app. `products` is the catalog read (all or one studio), and
// `product` is the detail read. Accepted purchases use the off-app proof
// workflow exposed by the purchase router.
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
    .input(z.object({ producerId: z.string().uuid().optional() }).optional())
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
          and(eq(clientContacts.clerkUserId, ctx.clerkUserId), isNull(clientContacts.archivedAt)),
        );

      const myProducerIds = [...new Set(myContacts.map((c) => c.producerId))];

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

      const scopedProducerIds = producerId === undefined ? myProducerIds : [producerId];

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
          // Migration 0019 — business-level tax disclosure mode + rate.
          // Surfaced on every product card next to the price.
          producerTaxMode: producers.taxMode,
          producerTaxRatePct: producers.taxRatePct,
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
        // Artist surfaces show only the human tagline — the wizard encodes
        // revisions/contract terms into description after a "---" marker
        // (SK-49: the raw block leaked onto the store cards).
        description: decodeDescription(r.description).tagline || null,
        priceCents: r.priceCents,
        currency: r.currency,
        durationMin: r.durationMin,
        sessionCount: r.sessionCount,
        kind: r.kind,
        pricingModel: r.pricingModel as "flat" | "per_song" | "hourly" | "bundle",
        volumeTiers: r.volumeTiers ?? null,
        paymentPlans: r.paymentPlans,
        producerId: r.producerId,
        producerName: r.producerName ?? "Untitled Studio",
        producerSlug: r.producerSlug,
        producerTaxMode: r.producerTaxMode,
        producerTaxRatePct: r.producerTaxRatePct,
      }));

      return { products: mapped };
    }),

  // Single product detail. Access-gated on (clerkUserId, producerId) —
  // rejects with NOT_FOUND if the artist doesn't have a clientContacts
  // row for this product's producer.
  product: artistProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hasCommercialTermsColumns = await productCommercialTermsColumnsAvailable(ctx.db);
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
          // Funnel S3/S4 surfaces (SK-46) — the what's-included list and
          // the producer's uploaded agreement PDF.
          deliverables: products.deliverables,
          contractUrl: products.contractUrl,
          ...(hasCommercialTermsColumns
            ? {
                royaltyTerms: products.royaltyTerms,
                agreementText: products.agreementText,
              }
            : {}),
          producerId: products.producerId,
          producerName: producers.displayName,
          producerSlug: producers.slug,
          // Migration 0019 — tax mode + rate for the detail page's
          // price disclosure.
          producerTaxMode: producers.taxMode,
          producerTaxRatePct: producers.taxRatePct,
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

      const decodedDescription = decodeDescription(row.description);
      const savedAgreementText = "agreementText" in row ? (row.agreementText ?? null) : undefined;
      const agreementText =
        savedAgreementText !== null && savedAgreementText !== undefined
          ? savedAgreementText.trim().length > 0
            ? savedAgreementText
            : null
          : decodedDescription.contractText || null;

      return {
        id: row.id,
        name: row.name,
        // Tagline only — see SK-49 note on the list read above.
        description: decodedDescription.tagline || null,
        revisions: decodedDescription.revisions,
        priceCents: row.priceCents,
        currency: row.currency,
        durationMin: row.durationMin,
        sessionCount: row.sessionCount,
        kind: row.kind,
        pricingModel: row.pricingModel as "flat" | "per_song" | "hourly" | "bundle",
        volumeTiers: row.volumeTiers ?? null,
        paymentPlans: row.paymentPlans,
        deliverables: row.deliverables ?? null,
        contractUrl: row.contractUrl ?? null,
        royaltyTerms: "royaltyTerms" in row ? (row.royaltyTerms ?? null) : null,
        agreementText,
        producerId: row.producerId,
        producerName: row.producerName ?? "Untitled Studio",
        producerSlug: row.producerSlug,
        producerTaxMode: row.producerTaxMode,
        producerTaxRatePct: row.producerTaxRatePct,
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
  // Producer's business-level tax disclosure mode + rate (migration
  // 0019). String + integer on the wire — the UI narrows via
  // coerceTaxMode() and clamps the rate defensively.
  producerTaxMode: string;
  producerTaxRatePct: number;
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
        and(eq(clientContacts.clerkUserId, ctx.clerkUserId), isNull(clientContacts.archivedAt)),
      );

    // brand is jsonb {logoUrl?: string, ...} — normalize to scalar
    const flat = rows.map((r) => ({
      producerId: r.producerId,
      producerName: r.producerName ?? "Untitled Studio",
      producerSlug: r.producerSlug,
      producerLogoUrl: (r.producerLogoUrl as { logoUrl?: string } | null)?.logoUrl ?? null,
      lastSeenAt: r.lastSeenAt,
    }));

    return { studios: groupStudiosForArtist(flat) };
  }),

  // Home tab feed: next session, latest mix, outstanding balance, and
  // a 10-item activity stream — all in a single round-trip.
  //
  // The query fans out via Promise.all across the artist's studios so a
  // signed-in user with three studios pays the same wall-time as one
  // with one. Each sub-query independently joins the exact active
  // producer/email relationship for the signed-in artist.
  home: artistProcedure.query(async ({ ctx }) => {
    const now = new Date();

    // 2-5. Parallelize the four data needs. Each sub-query is its own
    // self-contained SELECT; if any one fails the whole call fails
    // (acceptable — Home is a single coherent surface, partial data
    // would be confusing).
    const [
      nextSessionRows,
      upcomingSessionRows,
      latestMixRows,
      activityTrackRows,
      activityBookingRows,
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
          commercialSnapshot: purchases.commercialSnapshot,
        })
        .from(bookings)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .innerJoin(
          clientContacts,
          activeArtistClientOwner(ctx.clerkUserId, {
            producerId: purchases.producerId,
            clientContactId: purchases.clientContactId,
          }),
        )
        .where(and(eq(bookings.status, "confirmed"), gte(bookings.startsAt, now)))
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
          commercialSnapshot: purchases.commercialSnapshot,
        })
        .from(bookings)
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .innerJoin(
          clientContacts,
          activeArtistClientOwner(ctx.clerkUserId, {
            producerId: purchases.producerId,
            clientContactId: purchases.clientContactId,
          }),
        )
        .where(and(eq(bookings.status, "confirmed"), gte(bookings.startsAt, now)))
        .orderBy(asc(bookings.startsAt))
        .limit(10),

      // (3) Latest mix — the most recent track_version uploaded for
      // any project tied to my (producer, email). Joins through the
      // project_tracks → projects chain because track_versions only
      // know their parent track, not the project's owner.
      //
      // SK-33: the exact relationship join also supplies lastSeenAt so
      // we can derive `unread` below.
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
          lastSeenAt: clientContacts.lastSeenAt,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .innerJoin(producers, eq(producers.id, projects.producerId))
        .innerJoin(
          clientContacts,
          activeArtistClientOwner(ctx.clerkUserId, {
            producerId: projects.producerId,
            clientContactId: projects.clientContactId,
          }),
        )
        .where(
          and(
            ne(projects.lifecycleStatus, "waiting_for_payment"),
            isNotNull(trackVersions.audioUrl),
            isNull(trackVersions.audioDeletedAt),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(1),

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
        .innerJoin(
          clientContacts,
          activeArtistClientOwner(ctx.clerkUserId, {
            producerId: projects.producerId,
            clientContactId: projects.clientContactId,
          }),
        )
        .where(
          and(
            ne(projects.lifecycleStatus, "waiting_for_payment"),
            isNotNull(trackVersions.audioUrl),
            isNull(trackVersions.audioDeletedAt),
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
        .innerJoin(
          purchases,
          and(
            eq(purchases.id, bookings.purchaseId),
            eq(purchases.projectId, bookings.projectId),
            eq(purchases.producerId, bookings.producerId),
          ),
        )
        .innerJoin(producers, eq(producers.id, bookings.producerId))
        .innerJoin(
          clientContacts,
          activeArtistClientOwner(ctx.clerkUserId, {
            producerId: purchases.producerId,
            clientContactId: purchases.clientContactId,
          }),
        )
        .where(eq(bookings.status, "confirmed"))
        .orderBy(desc(bookings.statusChangedAt))
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
          productName: purchaseProductName(nextRow.commercialSnapshot, "Session"),
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
          // SK-33: derive `unread` for the NEW badge on the Last
          // Upload hero. True when the relationship's seen-at predates
          // the upload.
          unread: mixRow.lastSeenAt.getTime() < mixRow.uploadedAt.getTime(),
        }
      : null;

    // The old single-currency invoice rollup cannot represent several
    // purchase ledgers. Keep the compatibility field unavailable.
    const outstandingBalance: {
      totalCents: number;
      currency: string;
      nextDueAt: Date | null;
    } | null = null;

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
    activity.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    const cappedActivity = activity.slice(0, 10);

    return {
      nextSession,
      upcomingSessions: upcomingSessionRows.map((s) => ({
        id: s.id,
        startsAt: s.startsAt,
        durationMin: s.durationMin,
        producerName: s.producerName ?? "Producer",
        packageName: purchaseProductName(s.commercialSnapshot, "Session"),
      })),
      latestMix,
      outstandingBalance,
      activity: cappedActivity,
    };
  }),

  // Soft-disconnect the signed-in artist from one of their studios.
  // Sets clientContacts.archivedAt so every artist-side read filters
  // the row out (the row itself stays for the producer's CRM history).
  //
  // Blocked when the artist has an active booking owned by one of their
  // stable client-contact rows for this producer.
  disconnectProducer: artistProcedure
    .input(z.object({ producerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${input.producerId}, 0))`,
        );

        const myContacts = await tx
          .select({ id: clientContacts.id })
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.clerkUserId, ctx.clerkUserId),
              eq(clientContacts.producerId, input.producerId),
              isNull(clientContacts.archivedAt),
            ),
          )
          .for("update");
        if (myContacts.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const myContactIds = myContacts.map((contact) => contact.id);

        const activeBookings = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .innerJoin(
            purchases,
            and(
              eq(purchases.id, bookings.purchaseId),
              eq(purchases.projectId, bookings.projectId),
              eq(purchases.producerId, bookings.producerId),
            ),
          )
          .where(
            and(
              eq(bookings.producerId, input.producerId),
              inArray(purchases.clientContactId, myContactIds),
              inArray(bookings.status, ["pending_approval", "confirmed"]),
            ),
          )
          .limit(1);
        if (activeBookings.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot disconnect — you have active bookings with this producer.",
          });
        }

        await tx
          .update(clientContacts)
          .set({ archivedAt: new Date() })
          .where(
            and(
              inArray(clientContacts.id, myContactIds),
              eq(clientContacts.clerkUserId, ctx.clerkUserId),
              eq(clientContacts.producerId, input.producerId),
              isNull(clientContacts.archivedAt),
            ),
          );
      });

      return { ok: true as const };
    }),

  // Nested sub-router so future siblings (project detail, addComment,
  // etc.) live under the same `artist.music.*` namespace.
  music: musicSubrouter,

  // Block-based weekly calendar. availability + confirm for the
  // self-serve booking flow. See bookSubrouter for per-procedure docs.
  book: bookSubrouter,

  // Catalog reads. See storeSubrouter for per-procedure docs.
  store: storeSubrouter,

  // Purchase flow (SK-37 / BE-1). request / acceptAgreement / get plus
  // the frozen BE-2/3/4 stubs. Lives in its own file so the backend
  // track never collides with the screens track.
  purchase: artistPurchaseRouter,
});

// Activity-feed item shape — exported for the component prop type.
export type ActivityItem = {
  kind: "track_uploaded" | "session_confirmed" | "invoice_paid";
  message: string;
  occurredAt: Date;
  producerName: string;
  deepLink: string | null;
};
