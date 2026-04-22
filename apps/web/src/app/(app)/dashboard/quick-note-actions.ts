"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Server actions for the Today cockpit's Quick Note modal. Replaces
// the localStorage stub with real DB-backed persistence (audit Task
// 11). The client modal calls these via `startTransition` rather than
// exposing tRPC over HTTP — matches the existing pattern across the
// producer dashboard (`settings/actions.ts`, `booking/actions.ts`,
// etc.).
//
// Every action resolves the caller's Clerk userId via `auth()`; the
// underlying tRPC `producerProcedure` middleware then loads the
// producer row + gates out artists. Artists + unauthenticated users
// get a generic error (no enumeration).

export type SaveNoteResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function saveQuickNote(body: string): Promise<SaveNoteResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    const row = await caller.producerNotes.save({ body });
    // The Today page doesn't currently render a notes list, but
    // revalidate to keep the shell fresh if we later add a
    // notifications-style surface for recent notes.
    revalidatePath("/dashboard");
    return { ok: true, id: row.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't save the note.",
    };
  }
}

export type DeleteNoteResult = { ok: true } | { ok: false; error: string };

export async function deleteQuickNote(id: string): Promise<DeleteNoteResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    await caller.producerNotes.delete({ id });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't delete the note.",
    };
  }
}
