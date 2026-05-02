/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  ClientsProjectsTab,
  type ClientRow,
  type ProjectRow,
} from "../../_design-test/clients-projects-tab";
import {
  gradFor,
  humanStage,
  initialsOf,
  progressForStage,
  tagForStage,
} from "../../_design-test/data-mapping";

// Clients & Projects tab. Shell lives in (sandbox)/layout.tsx;
// this page fetches its own project + client aggregates and
// returns the inner tab body.

export default async function ProjectsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [projectsAll, byClient] = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "all-projects" }),
    caller.clientContacts.listWithProjects(),
  ]);

  const projectRows: ProjectRow[] =
    projectsAll.view === "all-projects"
      ? projectsAll.projects.map((p, i) => {
          const stageTag = tagForStage(p.stage);
          const total = Math.round(p.priceCents / 100);
          const paid = Math.round(
            (p.priceCents - p.outstandingCents) / 100,
          );
          const songCount = 0;
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

  return <ClientsProjectsTab data={{ projects: projectRows, clients: clientRows }} />;
}
