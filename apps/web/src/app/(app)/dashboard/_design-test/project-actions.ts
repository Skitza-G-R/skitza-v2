"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

import { validateNewProjectInput, type NewProjectInput } from "./create-validators";

// Server action for the design-test "New Project" modal. Wraps
// project.create and revalidates the projects list so the new card
// appears immediately on RSC refresh. Returns the new project's id
// so the modal can navigate to its room (/dashboard/projects/[id]).

export type CreateProjectResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createProject(
  input: NewProjectInput,
): Promise<CreateProjectResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  const localError = validateNewProjectInput(input);
  if (localError) return { ok: false, error: localError };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.project.create({
      title: input.title.trim(),
      artistName: input.artistName.trim(),
      artistEmail: input.artistEmail.trim(),
    });
    revalidatePath("/dashboard/projects");
    return { ok: true, id: result.project.id };
  } catch (err) {
    if (err instanceof TRPCError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't create project.",
    };
  }
}
