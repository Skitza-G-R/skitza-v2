/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  ClientsProjectsTab,
  type ClientRow,
  type ProjectRow,
} from "../_design-test/clients-projects-tab";
import {
  gradFor,
  humanStage,
  initialsOf,
  progressForStage,
  tagForStage,
} from "../_design-test/data-mapping";
import { DesignShell } from "../_design-test/design-shell";
import { buildPaletteData } from "../_design-test/palette-data";
import type { Producer } from "../_design-test/shell";

// gili/design-test branch — Clients & Projects tab. Wires the mockup's
// list view + clients grid against real Skitza data via
// `clientContacts.listWithProjects()` (returns enriched per-project +
// per-client aggregates with outstandingCents/lifetimeCents already
// computed server-side).

export default async function ProjectsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [me, projectsAll, byClient, paletteData] = await Promise.all([
    caller.producer.me(),
    caller.clientContacts.listWithProjects({ view: "all-projects" }),
    caller.clientContacts.listWithProjects(),
    buildPaletteData(caller),
  ]);

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  // Map projects to mockup row shape. `outstandingCents/lifetimeCents`
  // come from the server-side aggregate; we don't have a real
  // `deadline` column on the projects table yet, so we surface
  // `nextSessionAt` (when set) as the deadline display, falling back
  // to a long-future "—" so the row still renders cleanly.
  const projectRows: ProjectRow[] =
    projectsAll.view === "all-projects"
      ? projectsAll.projects.map((p, i) => {
          const stageTag = tagForStage(p.stage);
          const total = Math.round(p.priceCents / 100);
          const paid = Math.round(
            (p.priceCents - p.outstandingCents) / 100,
          );
          const songCount = 0; // not in this query — we'd need a per-project songs count
          // Deadline display from nextSessionAt when available. Negative
          // deadlineDays = overdue (the "X d late" display). If there's
          // no next session, set deadlineDays to a high number so the
          // sort-by-deadline lands these at the bottom.
          let deadline = "—";
          let deadlineDays = 9999;
          if (p.nextSessionAt) {
            const ms = p.nextSessionAt.getTime() - Date.now();
            deadlineDays = Math.round(ms / (24 * 60 * 60 * 1000));
            const dt = p.nextSessionAt;
            deadline = dt.toLocaleDateString("en-US", {
              month: "short",
              day: "2-digit",
            });
          }
          return {
            id: p.id,
            name: p.title,
            client:
              p.client.name ?? p.clientName ?? p.artistName ?? "Client",
            stage: p.stage.replace(/_/g, " "),
            status: humanStage(p.stage),
            tag: stageTag.label,
            tagType: stageTag.type,
            grad: gradFor(i),
            progress: progressForStage(p.stage),
            paid,
            total,
            songs: songCount,
            sessions: p.nextSessionAt ? 1 : 0,
            deadline,
            deadlineDays,
          };
        })
      : [];

  const clientRows: ClientRow[] =
    byClient.view === "by-client"
      ? byClient.clients.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          initials: initialsOf(c.name),
          projects: c.totalProjectCount,
          balance: Math.round(c.outstandingCents / 100),
          totalLifetime: Math.round(c.lifetimeCents / 100),
        }))
      : [];

  return (
    <DesignShell producer={producer} paletteData={paletteData}>
      <ClientsProjectsTab data={{ projects: projectRows, clients: clientRows }} />
    </DesignShell>
  );
}
