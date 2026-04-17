"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { ZodError, z } from "zod";
import { createDb, waitlist } from "@skitza/db";

import { checkRateLimit } from "~/lib/rate-limit/in-memory";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Allow-list of CTA locations so we can measure conversion by source.
// New entries can be added freely; unknown values are stripped.
const SourceEnum = z
  .enum(["landing-hero", "landing-final-cta", "landing-nav", "landing-pricing"])
  .optional();

const Input = z.object({
  email: z.string().email("please enter a valid email"),
  source: SourceEnum,
});

// Rate-limit per-IP. Generous enough for real users, tight enough that a
// scripted loop doesn't fill the table.
const WAITLIST_LIMIT = 10;
const WAITLIST_WINDOW_MS = 60_000;

export async function joinWaitlist(input: {
  email: string;
  source?: string;
}): Promise<ActionResult> {
  // 1. Validate input. Don't touch DB or headers until validated.
  let parsed;
  try {
    parsed = Input.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { ok: false, error: first?.message ?? "invalid input" };
    }
    return { ok: false, error: "invalid input" };
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { ok: false, error: "service temporarily unavailable" };

  // 2. Hash IP + record UA. Never store raw IP — matches privacy
  //    page's explicit "no raw IPs" commitment.
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = hdrs.get("user-agent");
  const ipHash = createHash("sha256").update(ipRaw).digest("hex");

  // 3. Rate limit on hashed IP. Same primitive as magicLink.issue.
  const rl = checkRateLimit(`waitlist:${ipHash}`, WAITLIST_LIMIT, WAITLIST_WINDOW_MS);
  if (!rl.ok) return { ok: false, error: "too many requests — try again in a moment" };

  // 4. INSERT … ON CONFLICT DO NOTHING on email. Re-submitting is a
  //    user-visible no-op ("You're in" either way); we never tell the
  //    user whether they were already on the list.
  try {
    const db = createDb(dbUrl);
    await db
      .insert(waitlist)
      .values({
        email: parsed.email.toLowerCase(),
        source: parsed.source ?? null,
        userAgent,
        ipHash,
      })
      .onConflictDoNothing();
    return { ok: true };
  } catch {
    // Don't surface raw pg errors. Logs on Vercel carry the real cause.
    return { ok: false, error: "couldn't save — please try again" };
  }
}
