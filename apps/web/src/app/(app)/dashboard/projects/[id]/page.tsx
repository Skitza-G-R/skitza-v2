import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { ProjectView } from "./project-view";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProjectDetail({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.project.detail({ id });
  } catch {
    notFound();
  }

  // Contracts: list all producer contracts and client-filter by
  // contract.projectId. Degrade gracefully if the router errors
  // (cross-branch schema skew).
  let contractsForProject: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    signedAt: Date | null;
  }[] = [];
  try {
    const all = await caller.contract.list();
    contractsForProject = all
      .filter((c) => c.projectId === id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        createdAt: c.createdAt,
        signedAt: c.signedAt,
      }));
  } catch {
    contractsForProject = [];
  }

  return (
    <AppShell active="pipeline">
      <ProjectView
        project={{
          id: data.project.id,
          title: data.project.title,
          stage: data.project.stage,
          artistName: data.project.artistName,
          artistEmail: data.project.artistEmail,
          clientName: data.project.clientName,
          clientEmail: data.project.clientEmail,
          depositPaid: data.project.depositPaid,
          finalPaid: data.project.finalPaid,
          createdAt: data.project.createdAt,
          updatedAt: data.project.updatedAt,
        }}
        tracks={data.tracks.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          position: t.position,
        }))}
        versions={data.versions.map((v) => ({
          id: v.id,
          trackId: v.trackId,
          label: v.label,
          audioUrl: v.audioUrl,
          uploadedAt: v.uploadedAt,
          approvedAt: v.approvedAt,
        }))}
        comments={data.comments.map((c) => ({
          id: c.id,
          versionId: c.versionId,
          authorName: c.authorName,
          body: c.body,
          timestampMs: c.timestampMs,
          resolvedAt: c.resolvedAt,
          fromProducer: c.fromProducer,
          createdAt: c.createdAt,
        }))}
        contracts={contractsForProject}
      />
    </AppShell>
  );
}
