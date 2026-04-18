"use server";

import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { appRouter } from "~/server/trpc/routers/_app";

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
      case "NOT_FOUND":
        return "This project link isn't valid.";
      case "TOO_MANY_REQUESTS":
        return "Too many requests — try again in a moment.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function submitArtistComment(input: {
  token: string;
  versionId: string;
  authorName: string;
  authorEmail: string;
  body: string;
  timestampMs: number;
}): Promise<ActionResult> {
  try {
    const caller = appRouter.createCaller({ userId: null });
    await caller.project.publicComment(input);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
