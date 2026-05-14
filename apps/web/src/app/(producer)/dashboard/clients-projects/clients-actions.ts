"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CLIENTS_PATH = "/dashboard/clients-projects";

async function callerOrError(): Promise<
  | { ok: true; caller: ReturnType<typeof appRouter.createCaller> }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

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
      case "NOT_FOUND":
        return "Client not found.";
      case "FORBIDDEN":
        return "You don't have access to that client.";
      case "CONFLICT":
        return err.message || "A client with that email already exists.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Thin wrapper for clientContacts.sendInvite. The Invite-to-App modal
// calls this with via='email' (real Resend dispatch) or via='link'
// (the producer copied the URL to clipboard — server side only stamps
// invited_at). On success, revalidates the list path so the LinkPill
// flips from "Invite to app" → "Invited" without a hard reload.
//
// All other server actions from the pre-Phase-1 panels (createClient /
// removeClient / updateClient / fetchClientDetail) were dropped along
// with the panels themselves in the redesign deletion sweep.
export async function sendClientInviteAction(input: {
  id: string;
  via: "email" | "link";
}): Promise<ActionDataResult<{ invitedAtIso: string; via: "email" | "link" }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.sendInvite(input);
    revalidatePath(CLIENTS_PATH);
    return {
      ok: true,
      data: {
        invitedAtIso:
          res.invitedAt instanceof Date
            ? res.invitedAt.toISOString()
            : new Date(res.invitedAt).toISOString(),
        via: res.via,
      },
    };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
