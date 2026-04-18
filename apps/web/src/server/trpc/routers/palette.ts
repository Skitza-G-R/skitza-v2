import {
  and,
  clientContacts,
  contracts,
  projectTracks,
  projects,
  desc,
  eq,
  ilike,
  or,
  trackVersions,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// ⌘K command palette search. Unions three producer-scoped streams
// (projects, client contacts, contracts) behind one procedure so the
// client can render grouped results without fanning out to three
// queries. Kept flat + deliberately simple — no full-text index yet,
// just ilike on 1–5 columns per table with a per-type cap of 10.
//
// Empty query is a "recents" surface (last 5 per type by updatedAt /
// lastSeenAt) so ⌘K is useful the moment it opens.
export const paletteRouter = router({
  search: producerProcedure
    .input(z.object({ q: z.string().max(100) }))
    .query(async ({ ctx, input }) => {
      const raw = input.q.trim();

      if (raw.length === 0) {
        const [recentProjects, recentContacts, recentContracts, recentTracks] =
          await Promise.all([
            ctx.db
              .select()
              .from(projects)
              .where(eq(projects.producerId, ctx.producerId))
              .orderBy(desc(projects.updatedAt))
              .limit(5),
            ctx.db
              .select()
              .from(clientContacts)
              .where(eq(clientContacts.producerId, ctx.producerId))
              .orderBy(desc(clientContacts.lastSeenAt))
              .limit(5),
            ctx.db
              .select()
              .from(contracts)
              .where(eq(contracts.producerId, ctx.producerId))
              .orderBy(desc(contracts.createdAt))
              .limit(5),
            ctx.db
              .select({
                versionId: trackVersions.id,
                versionLabel: trackVersions.label,
                trackTitle: projectTracks.title,
                projectId: projects.id,
              })
              .from(trackVersions)
              .innerJoin(projectTracks, eq(trackVersions.trackId, projectTracks.id))
              .innerJoin(projects, eq(projectTracks.projectId, projects.id))
              .where(eq(projects.producerId, ctx.producerId))
              .orderBy(desc(trackVersions.uploadedAt))
              .limit(5),
          ]);
        return {
          projects: recentProjects.map((d) => ({ id: d.id, title: d.title, stage: d.stage })),
          contacts: recentContacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
          contracts: recentContracts.map((c) => ({ id: c.id, title: c.title, status: c.status })),
          tracks: recentTracks.map((t) => ({
            id: t.versionId,
            title: t.trackTitle,
            label: t.versionLabel,
            projectId: t.projectId,
          })),
        };
      }

      // Fuzzy ilike across identity fields. Projects get both the new
      // clientName/clientEmail and the legacy artistName/artistEmail
      // columns since they coexist on the row. Cap at 10 per type so
      // the palette list stays navigable from the keyboard.
      const pattern = `%${raw}%`;
      const [matchProjects, matchContacts, matchContracts, matchTracks] = await Promise.all([
        ctx.db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.producerId, ctx.producerId),
              or(
                ilike(projects.title, pattern),
                ilike(projects.clientName, pattern),
                ilike(projects.clientEmail, pattern),
                ilike(projects.artistName, pattern),
                ilike(projects.artistEmail, pattern),
              ),
            ),
          )
          .orderBy(desc(projects.updatedAt))
          .limit(10),
        ctx.db
          .select()
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.producerId, ctx.producerId),
              or(
                ilike(clientContacts.name, pattern),
                ilike(clientContacts.email, pattern),
              ),
            ),
          )
          .orderBy(desc(clientContacts.lastSeenAt))
          .limit(10),
        ctx.db
          .select()
          .from(contracts)
          .where(
            and(
              eq(contracts.producerId, ctx.producerId),
              ilike(contracts.title, pattern),
            ),
          )
          .orderBy(desc(contracts.createdAt))
          .limit(10),
        ctx.db
          .select({
            versionId: trackVersions.id,
            versionLabel: trackVersions.label,
            trackTitle: projectTracks.title,
            projectId: projects.id,
          })
          .from(trackVersions)
          .innerJoin(projectTracks, eq(trackVersions.trackId, projectTracks.id))
          .innerJoin(projects, eq(projectTracks.projectId, projects.id))
          .where(
            and(
              eq(projects.producerId, ctx.producerId),
              or(
                ilike(projectTracks.title, pattern),
                ilike(trackVersions.label, pattern),
              ),
            ),
          )
          .orderBy(desc(trackVersions.uploadedAt))
          .limit(10),
      ]);
      return {
        projects: matchProjects.map((d) => ({ id: d.id, title: d.title, stage: d.stage })),
        contacts: matchContacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
        contracts: matchContracts.map((c) => ({ id: c.id, title: c.title, status: c.status })),
        tracks: matchTracks.map((t) => ({
          id: t.versionId,
          title: t.trackTitle,
          label: t.versionLabel,
          projectId: t.projectId,
        })),
      };
    }),
});
