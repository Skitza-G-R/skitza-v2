"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

import type { Stage } from "./kanban-helpers";

// Kanban-scoped Server Actions. Distinct from projects/actions.ts
// because the Kanban lives at /dashboard (not /dashboard/projects) and
// therefore wants revalidation to hit a different path after a stage
// change. Kept minimal — only the drag-and-drop reorder calls this.

export type ActionResult = { ok: true } | { ok: false; error: string };

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
        return "Project not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function setStageAction(input: {
  id: string;
  stage: Stage;
}): Promise<ActionResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "Please sign in to continue." };
    const caller = appRouter.createCaller({ userId });
    await caller.project.setStage(input);
    // Revalidate both the Kanban root and the project detail paths so
    // any open tabs stay in sync with the new stage.
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/projects/${input.id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
