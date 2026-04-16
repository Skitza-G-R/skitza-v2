"use server";

import { auth } from "@clerk/nextjs/server";
import { createDb, eq, producers } from "@skitza/db";
import { z } from "zod";

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

  const parsed = Input.parse(input);
  const db = createDb(dbUrl);
  // updatedAt bumped explicitly; producers.updatedAt only defaults on insert.
  // .returning() so we can detect the webhook race: if the Clerk webhook
  // hasn't inserted the row yet, the UPDATE affects 0 rows and the user
  // would otherwise see a silent "success" with no DB change. Throwing
  // here lets the form surface "try again in a moment".
  const updated = await db
    .update(producers)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(producers.clerkUserId, userId))
    .returning({ id: producers.id });
  if (updated.length === 0) {
    throw new Error("profile not provisioned yet — please try again in a moment");
  }
}
