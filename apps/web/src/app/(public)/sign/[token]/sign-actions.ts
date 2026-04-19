"use server";

// Server Actions that wrap the three public contract procedures
// exposed to a signer:
//   - contract.publicByToken (mutation — records viewedAt)
//   - contract.publicFillField
//   - contract.publicSign
//
// The signer is unauthenticated — no Clerk check, caller is built
// with { userId: null }. Mirrors the shape of
// dashboard/projects/actions.ts so error mapping and result types
// match the rest of the app.

import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
        return "This signing link isn't valid or has expired. Ask the producer to resend it.";
      case "FORBIDDEN":
        return "Only the producer can change that field.";
      case "PRECONDITION_FAILED":
        return err.message || "This contract isn't ready to sign yet.";
      case "BAD_REQUEST":
        return err.message || "Check the form and try again.";
      default:
        return "Something broke on our end. Try again in a moment.";
    }
  }
  return err instanceof Error ? err.message : "Something broke on our end. Try again in a moment.";
}

function caller() {
  return appRouter.createCaller({ userId: null });
}

// Set a single field's signed value. Called on blur/change from the
// signer UI — optimistic; UI keeps local state and calls through.
export async function fillField(input: {
  token: string;
  fieldId: string;
  value: string;
}): Promise<ActionResult> {
  try {
    await caller().contract.publicFillField(input);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Final sign. Returns `allSigned` so the UI can tailor the success
// message ("Signed — waiting on co-signers" vs "Complete").
export async function signContract(input: {
  token: string;
}): Promise<ActionDataResult<{ allSigned: boolean }>> {
  try {
    const res = await caller().contract.publicSign(input);
    return { ok: true, data: { allSigned: res.allSigned } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
