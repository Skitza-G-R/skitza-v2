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

  let evt: { type: string; data: { id: string; email_addresses: { email_address: string }[]; first_name?: string } };
  try {
    evt = new Webhook(secret).verify(payload, headers) as typeof evt;
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  if (evt.type === "user.created") {
    const email = evt.data.email_addresses[0]?.email_address;
    if (!email) return new Response("no email", { status: 400 });
    const db = createDb(dbUrl);
    await db.insert(producers).values({
      clerkUserId: evt.data.id,
      email,
      displayName: evt.data.first_name ?? null,
      slug: emailToSlug(email),
    }).onConflictDoNothing().returning();
  }

  return new Response("ok", { status: 200 });
}
