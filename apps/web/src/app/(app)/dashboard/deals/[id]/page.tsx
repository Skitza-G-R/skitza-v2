import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { DealView } from "./deal-view";

type PageProps = { params: Promise<{ id: string }> };

export default async function DealDetail({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.deal.detail({ id });
  } catch {
    notFound();
  }

  // Contracts: try listing all producer contracts and client-filter by
  // contract.projectId (the column still has the legacy name but FKs
  // deals.id after C.1). Degrade gracefully if the router errors
  // (cross-branch schema skew).
  let contractsForDeal: {
    id: string;
    title: string;
    artistName: string;
    status: string;
    createdAt: Date;
    signedAt: Date | null;
  }[] = [];
  try {
    const all = await caller.contract.list();
    contractsForDeal = all
      .filter((c) => c.projectId === id)
      .map((c) => ({
        id: c.id,
        title: c.title,
        artistName: c.artistName,
        status: c.status,
        createdAt: c.createdAt,
        signedAt: c.signedAt,
      }));
  } catch {
    contractsForDeal = [];
  }

  return (
    <AppShell active="pipeline">
      <DealView
        deal={{
          id: data.deal.id,
          title: data.deal.title,
          stage: data.deal.stage,
          artistName: data.deal.artistName,
          artistEmail: data.deal.artistEmail,
          clientName: data.deal.clientName,
          clientEmail: data.deal.clientEmail,
          depositPaid: data.deal.depositPaid,
          finalPaid: data.deal.finalPaid,
          createdAt: data.deal.createdAt,
          updatedAt: data.deal.updatedAt,
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
        contracts={contractsForDeal}
      />
    </AppShell>
  );
}
