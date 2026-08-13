"use server";

import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import type {
  SongPublicSharingActionResult,
  SongPublicSharingView,
} from "~/components/music/song-public-link-controls";
import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";
import { appRouter } from "~/server/trpc/routers/_app";

function canonicalState(state: {
  trackId: string;
  linkEnabled: boolean;
  portfolioPublished: boolean;
  remainingAudioCount: number;
  tokenVersion: number | null;
  publicUrl: string | null;
}): SongPublicSharingView {
  return {
    trackId: state.trackId,
    linkEnabled: state.linkEnabled,
    portfolioPublished: state.portfolioPublished,
    remainingAudioCount: state.remainingAudioCount,
    tokenVersion: state.tokenVersion,
    publicUrl:
      state.publicUrl?.startsWith("/listen/") === true
        ? `${PUBLIC_BRAND_ORIGIN}${state.publicUrl}`
        : null,
  };
}

function message(error: unknown): string {
  if (error instanceof TRPCError) {
    if (error.code === "UNAUTHORIZED") return "Please sign in to continue.";
    if (error.code === "NOT_FOUND") return "The song was not found.";
    return error.message || "The public song setting could not be updated.";
  }
  return "The public song setting could not be updated.";
}

async function mutate(
  operation: (
    caller: ReturnType<typeof appRouter.createCaller>,
  ) => Promise<{ state: Parameters<typeof canonicalState>[0] }>,
): Promise<SongPublicSharingActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const result = await operation(appRouter.createCaller({ userId }));
    revalidatePath("/dashboard/music");
    revalidatePath("/dashboard/clients-projects");
    revalidatePath("/dashboard/portfolio");
    revalidatePath("/join/[slug]", "page");
    revalidatePath("/listen/[token]", "page");
    return { ok: true, state: canonicalState(result.state) };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function publishPublicSongLink(input: {
  trackId: string;
  operationKey: string;
}): Promise<SongPublicSharingActionResult> {
  return mutate((caller) => caller.songPublication.publish(input));
}

export async function resetPublicSongLink(input: {
  trackId: string;
  operationKey: string;
}): Promise<SongPublicSharingActionResult> {
  return mutate((caller) => caller.songPublication.reset(input));
}

export async function disablePublicSongLink(input: {
  trackId: string;
  operationKey: string;
}): Promise<SongPublicSharingActionResult> {
  return mutate((caller) => caller.songPublication.disable(input));
}

export async function setSongPortfolioPublic(input: {
  trackId: string;
  operationKey: string;
  published: boolean;
}): Promise<SongPublicSharingActionResult> {
  return mutate((caller) => caller.songPublication.setPortfolioPublic(input));
}
