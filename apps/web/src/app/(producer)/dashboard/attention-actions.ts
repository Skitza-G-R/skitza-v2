"use server";

import { revalidatePath } from "next/cache";
import { auth } from "~/server/auth/clerk-identity";

import { appRouter } from "~/server/trpc/routers/_app";

// SK-284 — server actions behind the ✕ on a "Needs you" row. Same shape as
// the dashboard's other actions (`quick-note-actions.ts`, `settings/actions.ts`):
// the client calls these inside `startTransition` instead of exposing tRPC over
// HTTP. `auth()` resolves the Clerk user; the `producerProcedure` middleware
// then loads the producer row and gates out artists, so a caller can only ever
// hide rows in their own studio.
//
// Hiding is "until it changes": the stored timestamp only holds while it is
// newer than the subject's last real change, so nothing here has to run again
// to bring a row back.

export type AttentionResult = { ok: true } | { ok: false; error: string };

export async function dismissAttentionRow(input: {
  kind: string;
  subjectId: string;
}): Promise<AttentionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    await caller.producer.attention.dismiss(input);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't hide that row.",
    };
  }
}

/** Undo. Deleting the dismissal is the whole restore. */
export async function restoreAttentionRow(input: {
  kind: string;
  subjectId: string;
}): Promise<AttentionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    await caller.producer.attention.restore(input);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't bring that row back.",
    };
  }
}
