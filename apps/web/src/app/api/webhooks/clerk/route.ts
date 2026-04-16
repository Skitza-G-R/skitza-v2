import { Webhook } from "svix";
import { createDb, producers } from "@skitza/db";
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
  }

  return new Response("ok", { status: 200 });
}
