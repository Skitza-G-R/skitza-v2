import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { NoChargeSongAgreement } from "~/components/music/no-charge-song-agreement";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ proposalId: string }> };

export const metadata: Metadata = { title: "Review no charge song" };

export default async function NoChargeSongProposalPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { proposalId } = await params;
  try {
    const preview = await appRouter
      .createCaller({ userId })
      .project.noChargeProposal.preview({ proposalToken: proposalId });
    return <NoChargeSongAgreement preview={preview} />;
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN" || error.code === "BAD_REQUEST")
    ) {
      notFound();
    }
    throw error;
  }
}
