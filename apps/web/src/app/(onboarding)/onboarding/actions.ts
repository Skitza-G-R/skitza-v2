"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { createDb, producers } from "@skitza/db";
import { z } from "zod";
import { fetchUserRole } from "~/server/auth/role";

const Input = z.object({
  displayName: z.string().min(1).max(80),
  slug: z.string().min(3).max(48).regex(/^[a-z0-9-]+$/),
  defaultCurrency: z.enum(["USD", "EUR", "GBP", "ILS"]),
  timezone: z.string().min(1).max(64),
});

export async function completeOnboarding(input: z.infer<typeof Input>) {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  // Task 16 hardening — defense in depth. The (onboarding)/layout
  // gate already redirects artists to /artist before they see this
  // page, but that only protects the render path. A signed-in artist
  // could still craft a raw HTTP POST to this server action via
  // devtools or a script and, without this check, the upsert below
  // would create a producers row for them — silently converting
  // them from artist to producer. Fetch the role server-side and
  // reject explicitly.
  const role = await fetchUserRole({ dbUrl, userId });
  if (role.kind === "artist") {
    throw new Error(
      "forbidden: artists cannot access producer onboarding",
    );
  }

  const parsed = Input.parse(input);
  const db = createDb(dbUrl);

  // Upsert by clerkUserId so onboarding works whether the Clerk webhook
  // fired first or not — if the webhook hasn't run (not configured,
  // delayed, or failed delivery), the row is inserted fresh using the
  // email from Clerk's session; otherwise the auto-seeded row is
  // updated in place. This removes the webhook as a hard dependency
  // for the happy path: it becomes an optimisation, not a gate.
  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("unable to resolve email from Clerk session");

  try {
    await db
      .insert(producers)
      .values({
        clerkUserId: userId,
        email,
        displayName: parsed.displayName,
        slug: parsed.slug,
        defaultCurrency: parsed.defaultCurrency,
        timezone: parsed.timezone,
      })
      .onConflictDoUpdate({
        target: producers.clerkUserId,
        set: {
          displayName: parsed.displayName,
          slug: parsed.slug,
          defaultCurrency: parsed.defaultCurrency,
          timezone: parsed.timezone,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // Slug uniqueness is enforced at the DB level; surface a friendly
    // message instead of the raw postgres constraint error.
    if (
      err instanceof Error &&
      /duplicate key value/.test(err.message) &&
      /slug/.test(err.message)
    ) {
      throw new Error("that slug is already taken — please choose another");
    }
    throw err;
  }
}
