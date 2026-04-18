import {
  and,
  asc,
  projectTracks,
  projects,
  desc,
  eq,
  ilike,
  inArray,
  or,
  trackComments,
  trackVersions,
} from "@skitza/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// Audio library — every uploaded track version across every project
// the producer owns, Samply-style unified feed. The library is a
// derived view (no new tables): trackVersions → projectTracks →
// projects, filtered by producer ownership at the projects row.
//
// Filter semantics:
// - "all"       → every version
// - "unread"    → versions with ≥ 1 unresolved comment (i.e. something
//                 the artist left that still needs the producer's eye)
// - "resolved"  → versions that had comments AND all of them are
//                 resolved (a completed back-and-forth)
//
// The list query caps at 200 versions. Scroll-to-load isn't worth
// building until a producer hits that ceiling; the library naturally
// stays under a few dozen for months.
//
// Comment counts are computed in a single second query (inArray) and
// bucketed in-memory. That's N+1 safe: at most 2 round-trips.

// Shape returned by library.list — used by both the caller page and
// the client-side LibraryList component.
export type LibraryRow = {
  versionId: string;
  versionLabel: string;
  audioUrl: string | null;
  uploadedAt: Date;
  durationMs: number | null;
  trackId: string;
  trackTitle: string;
  projectId: string;
  projectTitle: string;
  projectArtistName: string;
  projectClientName: string | null;
  commentCount: number;
  unresolvedCount: number;
};

export const libraryRouter = router({
  list: producerProcedure
    .input(
      z
        .object({
          filter: z.enum(["all", "unread", "resolved"]).default("all"),
          projectId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<LibraryRow[]> => {
      const filter = input?.filter ?? "all";
      const projectId = input?.projectId;

      // Conditional predicate: scope to a single project when requested
      // (so /dashboard/library?projectId=… can be used as a deep-link
      // surface later). Otherwise all projects owned by the producer.
      const where = projectId
        ? and(eq(projects.producerId, ctx.producerId), eq(projects.id, projectId))
        : eq(projects.producerId, ctx.producerId);

      const rows = await ctx.db
        .select({
          versionId: trackVersions.id,
          versionLabel: trackVersions.label,
          audioUrl: trackVersions.audioUrl,
          uploadedAt: trackVersions.uploadedAt,
          durationMs: trackVersions.durationMs,
          trackId: projectTracks.id,
          trackTitle: projectTracks.title,
          projectId: projects.id,
          projectTitle: projects.title,
          projectArtistName: projects.artistName,
          projectClientName: projects.clientName,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(trackVersions.trackId, projectTracks.id))
        .innerJoin(projects, eq(projectTracks.projectId, projects.id))
        .where(where)
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(200);

      if (rows.length === 0) return [];

      const versionIds = rows.map((r) => r.versionId);
      const commentRows = await ctx.db
        .select({
          versionId: trackComments.versionId,
          id: trackComments.id,
          resolvedAt: trackComments.resolvedAt,
        })
        .from(trackComments)
        .where(inArray(trackComments.versionId, versionIds));

      const totalByVersion = new Map<string, number>();
      const unresolvedByVersion = new Map<string, number>();
      for (const c of commentRows) {
        totalByVersion.set(c.versionId, (totalByVersion.get(c.versionId) ?? 0) + 1);
        if (c.resolvedAt === null) {
          unresolvedByVersion.set(
            c.versionId,
            (unresolvedByVersion.get(c.versionId) ?? 0) + 1,
          );
        }
      }

      const enriched: LibraryRow[] = rows.map((r) => ({
        ...r,
        commentCount: totalByVersion.get(r.versionId) ?? 0,
        unresolvedCount: unresolvedByVersion.get(r.versionId) ?? 0,
      }));

      if (filter === "unread") return enriched.filter((r) => r.unresolvedCount > 0);
      if (filter === "resolved") {
        return enriched.filter(
          (r) => r.commentCount > 0 && r.unresolvedCount === 0,
        );
      }
      return enriched;
    }),

  // Detail view for the side panel / mobile modal. Ownership walk:
  // version → track → project → producer. Any broken link = 404/403.
  detail: producerProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [v] = await ctx.db
        .select({
          id: trackVersions.id,
          trackId: trackVersions.trackId,
          label: trackVersions.label,
          audioUrl: trackVersions.audioUrl,
          durationMs: trackVersions.durationMs,
          uploadedAt: trackVersions.uploadedAt,
        })
        .from(trackVersions)
        .where(eq(trackVersions.id, input.versionId))
        .limit(1);
      if (!v) throw new TRPCError({ code: "NOT_FOUND" });

      const [t] = await ctx.db
        .select({
          id: projectTracks.id,
          title: projectTracks.title,
          projectId: projectTracks.projectId,
        })
        .from(projectTracks)
        .where(eq(projectTracks.id, v.trackId))
        .limit(1);
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });

      const [d] = await ctx.db
        .select({
          id: projects.id,
          title: projects.title,
          artistName: projects.artistName,
          producerId: projects.producerId,
        })
        .from(projects)
        .where(eq(projects.id, t.projectId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND" });
      if (d.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const comments = await ctx.db
        .select()
        .from(trackComments)
        .where(eq(trackComments.versionId, v.id))
        .orderBy(asc(trackComments.timestampMs));

      return {
        version: v,
        track: { id: t.id, title: t.title, projectId: t.projectId },
        project: { id: d.id, title: d.title, artistName: d.artistName },
        comments,
      };
    }),

  // ⌘K palette helper — fuzzy-search track titles + version labels
  // owned by the producer. Scoped via the same project ownership join
  // as `list`. Cap at 10 so the palette stays keyboard-navigable.
  search: producerProcedure
    .input(z.object({ q: z.string().max(100) }))
    .query(async ({ ctx, input }) => {
      const raw = input.q.trim();
      if (raw.length === 0) return [];
      const pattern = `%${raw}%`;
      const rows = await ctx.db
        .select({
          versionId: trackVersions.id,
          versionLabel: trackVersions.label,
          trackTitle: projectTracks.title,
          projectId: projects.id,
          projectTitle: projects.title,
        })
        .from(trackVersions)
        .innerJoin(projectTracks, eq(trackVersions.trackId, projectTracks.id))
        .innerJoin(projects, eq(projectTracks.projectId, projects.id))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            or(ilike(projectTracks.title, pattern), ilike(trackVersions.label, pattern)),
          ),
        )
        .orderBy(desc(trackVersions.uploadedAt))
        .limit(10);
      return rows;
    }),
});
