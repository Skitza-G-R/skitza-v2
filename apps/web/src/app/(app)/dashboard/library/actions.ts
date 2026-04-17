"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

// Server Actions for the Library page. Mirrors the shape used in
// dashboard/deals/actions.ts so error messages stay consistent across
// surfaces.

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    if (first) {
      const field = first.path.join(".");
      return field ? `${field}: ${first.message}` : first.message;
    }
    return "Invalid input.";
  }
  if (err instanceof TRPCError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Please sign in to continue.";
      case "FORBIDDEN":
        return "You don't have access.";
      case "NOT_FOUND":
        return "Not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

export async function fetchVersionDetail(input: {
  versionId: string;
}): Promise<
  ActionResult<{
    version: {
      id: string;
      trackId: string;
      label: string;
      audioUrl: string | null;
      durationMs: number | null;
      uploadedAt: Date;
    };
    track: { id: string; title: string; dealId: string };
    deal: { id: string; title: string; artistName: string };
    comments: Array<{
      id: string;
      versionId: string;
      authorName: string;
      body: string;
      timestampMs: number;
      resolvedAt: Date | null;
      fromProducer: boolean;
      createdAt: Date;
    }>;
  }>
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    const data = await caller.library.detail(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addLibraryComment(input: {
  versionId: string;
  body: string;
  timestampMs: number;
}): Promise<
  ActionResult<{
    id: string;
    versionId: string;
    authorName: string;
    body: string;
    timestampMs: number;
    resolvedAt: Date | null;
    fromProducer: boolean;
    createdAt: Date;
  }>
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    const row = await caller.deal.addProducerComment({
      versionId: input.versionId,
      body: input.body,
      timestampMs: input.timestampMs,
    });
    // Refresh the library so the unread/resolved chips update on
    // navigation back. Side panel already patched optimistically.
    revalidatePath("/dashboard/library");
    return { ok: true, data: row };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function resolveLibraryComment(input: {
  id: string;
  resolved: boolean;
}): Promise<ActionResult<{ ok: true }>> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    await caller.deal.resolveComment(input);
    revalidatePath("/dashboard/library");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
