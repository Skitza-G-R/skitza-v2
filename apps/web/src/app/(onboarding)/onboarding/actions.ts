"use server";

import { randomBytes } from "node:crypto";

import { auth, currentUser } from "@clerk/nextjs/server";
import { createDb, producers } from "@skitza/db";
import { headers } from "next/headers";
import { z } from "zod";

import {
  inferCurrency,
  slugFromDisplayName,
} from "~/lib/onboarding/derive";
import { fetchUserRole } from "~/server/auth/role";

// Story 03 — completeStudio.
//
// Replaces the previous completeOnboarding action (which took
// caller-supplied slug + currency). The new shape only takes
// displayName + timezone from the client. Slug + currency are derived
// server-side, so the producer never has to think about either:
//
//   slug      = slugFromDisplayName(displayName, randomBytes(2).hex)
//   currency  = currencyFromCountry(headers().x-vercel-ip-country)
//
// Slug uniqueness is enforced at the DB level. Because the same
// displayName always derives the same body, two producers picking
// "Ada Studios" would race on the same body — the 4-char hex suffix
// (65 536 possibilities) makes that vanishingly unlikely, but we still
// retry up to 3 times on the duplicate-slug error before surfacing a
// friendly message.

const Input = z.object({
  displayName: z.string().trim().min(1).max(80),
  timezone: z.string().min(1).max(64),
});

const MAX_SLUG_ATTEMPTS = 3;

function isSlugConflict(err: unknown): boolean {
  return (
    err instanceof Error &&
    /duplicate key value/.test(err.message) &&
    /slug/.test(err.message)
  );
}

export async function completeStudio(input: {
  displayName: string;
  timezone: string;
}): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  // Defense in depth — see the long comment in the original
  // completeOnboarding action. The (onboarding)/layout gate redirects
  // artists at the render path, but a signed-in artist crafting a raw
  // HTTP POST to this server action (devtools / curl / a script)
  // bypasses the layout. Without this check they'd silently upsert a
  // producers row and "become" a producer.
  const role = await fetchUserRole({ dbUrl, userId });
  if (role.kind === "artist") {
    throw new Error("forbidden: artists cannot access producer onboarding");
  }

  const parsed = Input.parse(input);

  // Server-derive currency. Country header is the most specific signal
  // (Vercel injects x-vercel-ip-country in production); Accept-Language
  // is the next-best fallback — an Israeli producer browsing with a
  // Hebrew browser still gets ILS even when the geo header is missing
  // (which happens in some preview / proxy paths). USD is the final
  // fallback when neither signal is informative. See inferCurrency.
  const reqHeaders = await headers();
  const country = reqHeaders.get("x-vercel-ip-country");
  const acceptLanguage = reqHeaders.get("accept-language");
  const currency = inferCurrency(country, acceptLanguage);

  // Upsert by clerkUserId so onboarding works whether the Clerk webhook
  // fired first or not — same idempotent shape as completeOnboarding.
  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("unable to resolve email from Clerk session");

  const db = createDb(dbUrl);

  // Slug-retry loop. Use a for-loop (not recursion) so the iteration
  // budget is explicit and each attempt has its own try/catch. Every
  // attempt regenerates the hex suffix — same displayName, fresh
  // 4-char hash, fresh slug.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const hash = randomBytes(2).toString("hex");
    const slug = slugFromDisplayName(parsed.displayName, hash);

    try {
      await db
        .insert(producers)
        .values({
          clerkUserId: userId,
          email,
          displayName: parsed.displayName,
          slug,
          defaultCurrency: currency,
          timezone: parsed.timezone,
        })
        .onConflictDoUpdate({
          target: producers.clerkUserId,
          set: {
            displayName: parsed.displayName,
            slug,
            defaultCurrency: currency,
            timezone: parsed.timezone,
            updatedAt: new Date(),
          },
        });

      // TODO(telemetry): fire producer.onboarding.step_completed
      // with { step: "studio" }. No server-side analytics helper
      // exists yet — add one in a follow-up and emit here.
      return;
    } catch (err) {
      lastErr = err;
      if (isSlugConflict(err)) continue;
      // Any other DB error: rethrow immediately. The retry loop is
      // exclusively for slug-uniqueness collisions.
      throw err;
    }
  }

  // 3 consecutive slug conflicts. Statistically near-impossible (a
  // single name has 65 536 distinct hashes), but a 4th attempt won't
  // help — surface a friendly error so the producer can pick a slightly
  // different studio name to widen the body and almost-certainly avoid
  // the collision.
  if (lastErr) {
    throw new Error(
      "could not allocate slug — please try a slightly different studio name",
    );
  }
}
