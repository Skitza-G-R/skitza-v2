import { Webhook } from "svix";
import { createHash } from "node:crypto";
import { createDb, producers, clientContacts, eq, and, isNull } from "@skitza/db";
import { emailToSlug } from "~/lib/slug";

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  const dbUrl = process.env.DATABASE_URL;
  if (!secret || !dbUrl) return new Response("missing env", { status: 500 });

  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  // Webhook.verify returns `unknown`; treat the result as untrusted data
  // and pull each field defensively. A malformed event (e.g. { type } with
  // no data block) must produce a 4xx — Clerk retries 5xx forever.
  type ClerkEvent = {
    type?: string;
    data?: { id?: string; email_addresses?: { email_address?: string }[]; first_name?: string | null };
  };
  let evt: ClerkEvent;
  try {
    evt = new Webhook(secret).verify(payload, headers) as ClerkEvent;
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  if (evt.type === "user.created") {
    const id = evt.data?.id;
    const email = evt.data?.email_addresses?.[0]?.email_address;
    if (!id || !email) return new Response("invalid payload", { status: 400 });
    const db = createDb(dbUrl);
    await db.insert(producers).values({
      clerkUserId: id,
      email,
      displayName: evt.data?.first_name ?? null,
      slug: emailToSlug(email),
    }).onConflictDoNothing().returning();

    // Artist-stamping branch: every client_contacts row sharing this
    // email's hash gets the new Clerk user id. The IS NULL guard makes
    // this idempotent — re-fires (or a different Clerk user adopting
    // the same email later) leave already-owned rows untouched.
    // Single SQL UPDATE; matches across producers because email_hash
    // alone is the lookup key here, not (producerId, email_hash).
    const emailHash = createHash("sha256").update(email.toLowerCase()).digest("hex");
    await db.update(clientContacts)
      .set({ clerkUserId: id })
      .where(and(
        eq(clientContacts.emailHash, emailHash),
        isNull(clientContacts.clerkUserId),
      ));
  }

  return new Response("ok", { status: 200 });
}
