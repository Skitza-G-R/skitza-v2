"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";
import { appRouter } from "~/server/trpc/routers/_app";

// Two shapes share the same discriminator so callers can `if (res.ok)`
// uniformly. The data-bearing variant is used by issueLeadLink (which
// returns the one-shot URL); revokeLeadLink uses the bare variant.
export type ActionResult<T = undefined> = T extends undefined
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

const LEADS_PATH = "/dashboard/leads";

// The (app) layout already gates auth, but Server Actions are exposed as
// independent endpoints — re-derive userId here rather than trust the page.
async function callerOrError(): Promise<
  | { ok: true; caller: ReturnType<typeof appRouter.createCaller> }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

// Map tRPC / Zod failures to short, user-facing strings (mirrors
// portfolio/actions.ts).
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
        return "You don't have access to this lead link.";
      case "NOT_FOUND":
        return "Lead link not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function issueLeadLink(input: {
  target: "portfolio" | "booking";
  leadId?: string;
  ttlHours: number;
}): Promise<ActionResult<{ url: string; linkId: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    // The raw token is returned ONCE here and never persisted (only its
    // sha256 hash is stored). The dashboard table cannot reconstruct
    // the URL — surface it to the producer in a one-shot banner above
    // the table, then forget it. Do not be tempted to add a "copy URL"
    // button to existing rows; there is nothing to copy.
    const res = await c.caller.magicLink.issue({
      target: input.target,
      ttlHours: input.ttlHours,
      ...(input.leadId === undefined ? {} : { leadId: input.leadId }),
    });
    revalidatePath(LEADS_PATH);
    return { ok: true, data: { url: res.url, linkId: res.link.id } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function revokeLeadLink(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.magicLink.revoke({ id: input.id });
    revalidatePath(LEADS_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
