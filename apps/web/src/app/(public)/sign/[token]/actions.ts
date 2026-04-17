"use server";

import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true; alreadySigned: boolean } | { ok: false; error: string };

function toMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    if (first) return first.message;
    return "Invalid input.";
  }
  if (err instanceof TRPCError) {
    switch (err.code) {
      case "NOT_FOUND":
        return "This contract link isn't valid.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function submitSignature(input: {
  token: string;
  signatureDataUrl: string;
  acceptedName: string;
}): Promise<ActionResult> {
  try {
    const caller = appRouter.createCaller({ userId: null });
    const res = await caller.contract.publicSign(input);
    return { ok: true, alreadySigned: res.alreadySigned };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
