"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Same canonical pattern as dashboard/deals/actions.ts — wraps the
// tRPC caller, maps errors to plain-English copy, and revalidates the
// list + detail paths so the next navigation sees fresh data.

const PATH_LIST = "/dashboard/clients";
function pathDetail(id: string): string {
  return `/dashboard/clients/${id}`;
}

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
      case "FORBIDDEN":
        return "You don't have access.";
      case "NOT_FOUND":
        return "Client not found.";
      case "CONFLICT":
        // CONFLICT is thrown from update when the new email clashes
        // with another contact. Its message is already human-friendly.
        return err.message || "A client with that email already exists.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      case "TOO_MANY_REQUESTS":
        return err.message || "Slow down and try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Add a client.
//
// Distinguishes "created" from "already-existed" so the UI can switch
// to an "open their page" affordance instead of a success toast.
export async function createClientAction(input: {
  email: string;
  name: string;
}): Promise<
  ActionDataResult<{ id: string; existed: boolean; name: string; email: string }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.create(input);
    revalidatePath(PATH_LIST);
    return {
      ok: true,
      data: {
        id: res.id,
        existed: res.existed,
        name: res.name,
        email: res.email,
      },
    };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function updateClientAction(input: {
  id: string;
  name?: string;
  email?: string;
}): Promise<ActionDataResult<{ id: string; name: string; email: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.update(input);
    revalidatePath(PATH_LIST);
    revalidatePath(pathDetail(input.id));
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeClientAction(input: {
  id: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.remove(input);
    revalidatePath(PATH_LIST);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function sendClientMagicLinkAction(input: {
  id: string;
  target: "portfolio" | "booking";
}): Promise<
  ActionDataResult<{ url: string; target: "portfolio" | "booking"; expiresAt: Date }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.sendMagicLink({
      id: input.id,
      target: input.target,
    });
    // Don't revalidate here — the magic-link URL is returned only on
    // this response and no list view needs to reflect the new row in
    // the client CRM surface.
    return {
      ok: true,
      data: { url: res.url, target: res.target, expiresAt: res.expiresAt },
    };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
