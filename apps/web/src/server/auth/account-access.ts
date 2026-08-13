import { accountClosureRequests, and, eq, isNotNull, type Db } from "@skitza/db";

/** Primary app guards engage as soon as a verified closure starts. */
export async function isAccountClosureStarted(db: Db, clerkUserId: string): Promise<boolean> {
  const [closed] = await db
    .select({ id: accountClosureRequests.id })
    .from(accountClosureRequests)
    .where(
      and(
        eq(accountClosureRequests.clerkUserId, clerkUserId),
        isNotNull(accountClosureRequests.closureStartedAt),
      ),
    )
    .limit(1);
  return closed !== undefined;
}
