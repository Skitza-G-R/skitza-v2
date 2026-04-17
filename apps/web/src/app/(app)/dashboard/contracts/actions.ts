"use server";

// Contract editor — Server Actions. Thin wrappers around the contract
// router's producer-authenticated procedures. Canonical template from
// projects/actions.ts: auth gate → createCaller → toMessage on err →
// revalidatePath on mutation.
//
// These are the ONLY allowed client→server mutation path for the
// editor. The tRPC client library is deliberately not wired in the
// browser (see B.4 plan); forms and editors call these actions.

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const PATH_LIST = "/dashboard/contracts";
function pathDetail(id: string): string {
  return `/dashboard/contracts/${id}`;
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
        return "Not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// ─── Upload + draft creation ────────────────────────────────────────
// Presigned PUT URL for the PDF. The client then issues a plain PUT
// directly to R2 with the file body. No revalidation — nothing in the
// cache changes until createDraftContract runs.
export async function uploadPdf(input: {
  filename: string;
  sizeBytes: number;
}): Promise<ActionDataResult<{ key: string; url: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.contract.uploadPdf(input);
    return { ok: true, data: { key: res.key, url: res.url } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function createDraftContract(input: {
  title: string;
  pdfR2Key: string;
}): Promise<ActionDataResult<{ id: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.contract.createDraft(input);
    revalidatePath(PATH_LIST);
    return { ok: true, data: { id: res.id } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ─── Field bulk-upsert ──────────────────────────────────────────────
// The editor sends the FULL current field set every autosave tick;
// the router diffs by id. Validation of geometry happens there too.
type FieldPayload = {
  id?: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type:
    | "signature"
    | "initial"
    | "date"
    | "text"
    | "checkbox"
    | "dropdown"
    | "number";
  required?: boolean;
  recipientId?: string | null;
  prefilledValue?: string | null;
  options?: Record<string, unknown> | null;
};

export async function saveContractFields(input: {
  contractId: string;
  fields: FieldPayload[];
}): Promise<
  ActionDataResult<{
    fields: {
      id: string;
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      type: string;
      required: boolean;
      recipientId: string | null;
      prefilledValue: string | null;
      options: Record<string, unknown> | null;
    }[];
  }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.contract.saveFields(input);
    // Note: the router returns drizzle rows with x/y/w/h as strings
    // (numeric(5,2) → string). Normalise to numbers on the boundary so
    // the client never has to .parseFloat.
    const fields = res.fields.map((f) => ({
      id: f.id,
      page: f.page,
      x: Number(f.x),
      y: Number(f.y),
      w: Number(f.w),
      h: Number(f.h),
      type: f.type,
      required: f.required,
      recipientId: f.recipientId,
      prefilledValue: f.prefilledValue,
      options: f.options as Record<string, unknown> | null,
    }));
    revalidatePath(pathDetail(input.contractId));
    return { ok: true, data: { fields } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ─── Recipients ─────────────────────────────────────────────────────
// Raw signing token is returned ONCE by the router; we bubble it up
// as-is so the editor can build the signing URL right away.
export async function addContractRecipient(input: {
  contractId: string;
  email: string;
  name: string;
  role?: string;
}): Promise<ActionDataResult<{ id: string; signingToken: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.contract.addRecipient({
      contractId: input.contractId,
      email: input.email,
      name: input.name,
      role: input.role ?? "signer",
    });
    revalidatePath(pathDetail(input.contractId));
    return { ok: true, data: { id: res.id, signingToken: res.signingToken } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeContractRecipient(input: {
  id: string;
  contractId: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.contract.removeRecipient({ id: input.id });
    revalidatePath(pathDetail(input.contractId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// ─── Status transitions ─────────────────────────────────────────────
export async function sendContract(input: {
  contractId: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.contract.send(input);
    revalidatePath(PATH_LIST);
    revalidatePath(pathDetail(input.contractId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function cancelContract(input: {
  contractId: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.contract.cancel(input);
    revalidatePath(PATH_LIST);
    revalidatePath(pathDetail(input.contractId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
