"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

export async function cancelSessionAction(input: { id: string; operationKey: string }): Promise<
  | {
      ok: true;
      id: string;
      status: "cancelled";
      outcome: "cancelled_on_time" | "cancelled_late";
    }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.artist.book.cancel(input);
    revalidatePath("/artist/sessions");
    revalidatePath(`/artist/sessions/${input.id}`);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof TRPCError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not cancel this session" };
  }
}
