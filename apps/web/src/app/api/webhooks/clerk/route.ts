import { createHash } from "node:crypto";

import { Webhook } from "svix";
import { type Db, createDb, resolveCanonicalClerkUserIdWithDb } from "@skitza/db";
import {
  createRegisteredAccountSyncRepository,
  RegisteredAccountSyncError,
  synchronizeRegisteredAccount,
} from "~/server/identity/registered-account-sync";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function eventType(value: unknown): string | null {
  const event = record(value);
  return typeof event?.type === "string" ? event.type : null;
}

// The signed webhook synchronizes account lifecycle only. Artist access is
// granted separately by the authenticated join continuation, which rechecks
// the exact Producer, Clerk user, and verified email before writing a contact.
// Client-writeable unsafe_metadata and a public slug are never authorization.
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  const dbUrl = process.env.DATABASE_URL;
  const expectedInstanceId = process.env.CLERK_INSTANCE_ID;
  if (!secret || !dbUrl || !expectedInstanceId) {
    return new Response("missing env", { status: 500 });
  }

  const payload = await req.text();
  const svixId = req.headers.get("svix-id") ?? "";
  const headers = {
    "svix-id": svixId,
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let event: unknown;
  try {
    event = new Webhook(secret).verify(payload, headers);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const type = eventType(event);
  if (type !== "user.created" && type !== "user.updated" && type !== "user.deleted") {
    return new Response("ok", { status: 200 });
  }

  const eventDigest = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  const db = createDb(dbUrl);

  try {
    await db.transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      await synchronizeRegisteredAccount(
        createRegisteredAccountSyncRepository(tx),
        event,
        svixId,
        eventDigest,
        expectedInstanceId,
        (identity) => resolveCanonicalClerkUserIdWithDb(tx, identity),
      );
    });
  } catch (error) {
    if (error instanceof RegisteredAccountSyncError) {
      return new Response("invalid payload", { status: 400 });
    }
    throw error;
  }

  return new Response("ok", { status: 200 });
}
