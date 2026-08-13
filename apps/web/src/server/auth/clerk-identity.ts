import { auth as clerkAuth } from "@clerk/nextjs/server";
import { createDb, resolveCanonicalClerkUserIdWithDb } from "@skitza/db";

type ClerkAuthResult = Awaited<ReturnType<typeof clerkAuth>>;
export type CanonicalAuthResult = Omit<ClerkAuthResult, "userId"> &
  Readonly<{
    userId: string | null;
    providerUserId: string | null;
  }>;

/**
 * The only server-side Clerk auth entry point. `userId` is canonical for all
 * database and domain authorization. `providerUserId` remains the raw signed
 * Clerk id and is used only at provider/browser identity boundaries.
 */
export async function auth(): Promise<CanonicalAuthResult> {
  const providerSession = await clerkAuth();
  const providerUserId = providerSession.userId;
  if (!providerUserId) {
    return { ...providerSession, userId: null, providerUserId: null };
  }

  const clerkInstanceId = process.env.CLERK_INSTANCE_ID?.trim();
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!clerkInstanceId || !dbUrl) {
    // Existing isolated tests mock Clerk directly and intentionally have no
    // database. Production and development fail closed on missing identity
    // configuration; the bypass is impossible outside Vitest's test process.
    if (process.env.NODE_ENV === "test") {
      return { ...providerSession, userId: providerUserId, providerUserId };
    }
    throw new Error("missing Clerk identity configuration");
  }

  const userId = await resolveCanonicalClerkUserIdWithDb(createDb(dbUrl), {
    clerkInstanceId,
    providerClerkUserId: providerUserId,
  });
  return { ...providerSession, userId, providerUserId };
}
