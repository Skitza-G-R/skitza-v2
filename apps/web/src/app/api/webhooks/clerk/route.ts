import { createHash } from "node:crypto";

import { Webhook } from "svix";
import {
  type Db,
  clientContacts,
  createDb,
  eq,
  producers,
} from "@skitza/db";
import { emailToSlug } from "~/lib/slug";
import { emailHashFor } from "~/server/artist/identity";
import { stampUnownedArtistContactsForCreatedUser } from "~/server/contacts/connect-artist";
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

function createdUnsafeMetadata(value: unknown): UnknownRecord | null {
  const event = record(value);
  const data = record(event?.data);
  return record(data?.unsafe_metadata);
}

// The signed lifecycle receipt, registered-account snapshot, original
// producer/contact classification, and artist stamping all run in one
// transaction. A verified Svix retry is therefore either a complete no-op or
// a complete replay; a partial signup can never be acknowledged.
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
  if (
    type !== "user.created" &&
    type !== "user.updated" &&
    type !== "user.deleted"
  ) {
    return new Response("ok", { status: 200 });
  }

  const eventDigest = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  const db = createDb(dbUrl);

  try {
    await db.transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      const result = await synchronizeRegisteredAccount(
        createRegisteredAccountSyncRepository(tx),
        event,
        svixId,
        eventDigest,
        expectedInstanceId,
      );

      // Exact signed retries stop before every original signup side effect.
      if (
        result.replayed ||
        result.terminalDeleted ||
        result.lifecycle?.eventType !== "user.created"
      ) {
        return;
      }

      const {
        clerkUserId: id,
        displayName,
        emailVerified,
        primaryEmail: email,
      } = result.lifecycle.snapshot;
      if (!email) throw new RegisteredAccountSyncError();

      // `unsafe_metadata` is client-writeable. Choosing the join flow grants
      // no producer or artist access, but it must suppress implicit Producer
      // provisioning: a join-origin account can become a Producer only later
      // through the explicit Create-a-studio flow. The claimed producer slug
      // is never trusted until it resolves in this environment's database.
      const meta = createdUnsafeMetadata(event);
      const isJoinOrigin = meta?.signupOrigin === "join";
      const claimedSlug =
        isJoinOrigin && typeof meta.producerSlug === "string"
          ? meta.producerSlug
          : null;

      let targetProducerId: string | null = null;
      if (claimedSlug && emailVerified === true) {
        const [row] = await tx
          .select({ id: producers.id })
          .from(producers)
          .where(eq(producers.slug, claimedSlug))
          .limit(1);
        if (row) targetProducerId = row.id;
      }

      if (targetProducerId) {
        await tx
          .insert(clientContacts)
          .values({
            producerId: targetProducerId,
            emailHash: emailHashFor(email),
            email,
            name: displayName || email.split("@")[0] || "Artist",
            clerkUserId: id,
          })
          .onConflictDoNothing();
      } else if (!isJoinOrigin) {
        await tx
          .insert(producers)
          .values({
            clerkUserId: id,
            email,
            displayName,
            slug: emailToSlug(email),
          })
          .onConflictDoNothing()
          .returning();
      }

      // A stale/invalid target or an early unverified user.created snapshot
      // stays unconnected. The trusted POST continuation will revalidate and
      // connect it after authentication; do not let the broad legacy email
      // stamping path turn the failed join classification into a side effect.
      if (emailVerified === true && (!isJoinOrigin || targetProducerId)) {
        await stampUnownedArtistContactsForCreatedUser(tx, {
          email,
          clerkUserId: id,
        });
      }
    });
  } catch (error) {
    if (error instanceof RegisteredAccountSyncError) {
      return new Response("invalid payload", { status: 400 });
    }
    throw error;
  }

  return new Response("ok", { status: 200 });
}
