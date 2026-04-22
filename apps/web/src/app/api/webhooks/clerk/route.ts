import { Webhook } from "svix";
import {
  createDb,
  producers,
  clientContacts,
  eq,
  and,
  isNull,
} from "@skitza/db";
import { emailToSlug } from "~/lib/slug";
import { emailHashFor } from "~/server/artist/identity";

// Clerk user.created webhook — the single place where Skitza decides
// whether a brand-new Clerk user should become a Producer or an
// Artist (client_contacts).
//
// 2026-04-22 — CRITICAL BUG FIX (see docs/audit-report.md Task 15).
// Before this fix, every sign-up created a producers row unconditionally
// — including strangers who signed up via /join/<slug>. The /join page's
// CTA now routes through /sign-up/join/<slug>, which sets
// `unsafeMetadata={ signupOrigin: "join", producerSlug: slug }` on the
// Clerk <SignUp> component. That metadata rides along on the
// `user.created` event as `evt.data.unsafe_metadata` and lets this
// webhook branch:
//   JOIN   → insert client_contacts scoped to the target producer;
//            DO NOT create a producers row.
//   DEFAULT (any other signup, landing page / direct /sign-up / etc.)
//          → create a producers row, same as today.
//
// In BOTH branches we still run the "stamp any pre-existing
// client_contacts rows with clerkUserId" UPDATE afterward, so an
// artist who was invited by Producer X and later self-serves via
// Producer Y's /join link ends up linked on BOTH producer rosters.
//
// Safety: if the JOIN metadata's producerSlug doesn't resolve to a
// real producer (tampered client, stale slug, deleted producer), we
// FALL BACK to the default producer-insert branch rather than crash.
// Better an orphan producer row the user can ignore than a 5xx loop
// Clerk will retry forever.
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
    data?: {
      id?: string;
      email_addresses?: { email_address?: string }[];
      first_name?: string | null;
      // Client-settable metadata the <SignUp> component emits. We treat
      // this as untrusted (the "unsafe" prefix is Clerk's convention
      // for "writeable from the browser") and validate anything we
      // care about — here, the producerSlug is resolved against the DB.
      unsafe_metadata?: Record<string, unknown>;
    };
  };
  let evt: ClerkEvent;
  try {
    evt = new Webhook(secret).verify(payload, headers) as ClerkEvent;
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  if (evt.type !== "user.created") {
    return new Response("ok", { status: 200 });
  }

  const id = evt.data?.id;
  const email = evt.data?.email_addresses?.[0]?.email_address;
  if (!id || !email) return new Response("invalid payload", { status: 400 });
  const db = createDb(dbUrl);

  // Parse unsafe_metadata defensively. Anything we can't prove is
  // well-formed falls through to the default branch. Access via
  // optional chaining because the event schema marks it optional,
  // and each field is `unknown` until we type-narrow it.
  const meta = evt.data?.unsafe_metadata;
  const isJoinOrigin = meta?.signupOrigin === "join";
  const rawSlug = meta?.producerSlug;
  const claimedSlug =
    isJoinOrigin && typeof rawSlug === "string" ? rawSlug : null;

  // Resolve the producer by slug ONLY when we have a join-origin claim.
  // Skipping the lookup for plain signups avoids a wasted DB round-trip
  // on the hot path (most signups are producer-default).
  let targetProducerId: string | null = null;
  if (claimedSlug) {
    const [row] = await db
      .select({ id: producers.id })
      .from(producers)
      .where(eq(producers.slug, claimedSlug))
      .limit(1);
    if (row) targetProducerId = row.id;
  }

  if (targetProducerId) {
    // JOIN branch — this user is an artist. Create a client_contacts
    // row scoped to the target producer, carrying the Clerk user id so
    // the artist app can resolve their studios immediately on first
    // login. No producer row.
    //
    // onConflictDoNothing on (producerId, emailHash): if the producer
    // had already added this email to their CRM (pre-invite case),
    // the existing row stays put — clerkUserId gets stamped on it by
    // the UPDATE below (same code path the default branch uses).
    await db
      .insert(clientContacts)
      .values({
        producerId: targetProducerId,
        emailHash: emailHashFor(email),
        email: email.trim().toLowerCase(),
        // `name` is NOT NULL on client_contacts. Fall back through
        // first_name → local-part of email → a generic "Artist" so
        // the INSERT never fails a not-null constraint.
        name:
          evt.data?.first_name?.trim() ||
          email.trim().split("@")[0] ||
          "Artist",
        clerkUserId: id,
      })
      .onConflictDoNothing();
  } else {
    // DEFAULT branch (unchanged behavior from pre-2026-04-22):
    // producer-default signup. Insert a producers row seeded with an
    // email-derived slug + null displayName; /onboarding will fill
    // those in before the (app) layout lets them into /dashboard.
    await db
      .insert(producers)
      .values({
        clerkUserId: id,
        email,
        displayName: evt.data?.first_name ?? null,
        slug: emailToSlug(email),
      })
      .onConflictDoNothing()
      .returning();
  }

  // Artist-stamping branch (runs for BOTH paths): every client_contacts
  // row sharing this email's hash gets the new Clerk user id. The IS
  // NULL guard makes this idempotent — re-fires (or a different Clerk
  // user adopting the same email later) leave already-owned rows
  // untouched. Single SQL UPDATE; matches across producers because
  // email_hash alone is the lookup key here, not (producerId,
  // email_hash).
  const emailHash = emailHashFor(email);
  await db
    .update(clientContacts)
    .set({ clerkUserId: id })
    .where(
      and(
        eq(clientContacts.emailHash, emailHash),
        isNull(clientContacts.clerkUserId),
      ),
    );

  return new Response("ok", { status: 200 });
}
