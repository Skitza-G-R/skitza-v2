import { TRPCError } from "@trpc/server";
import { createDb, eq, producers } from "@skitza/db";
import { publicProcedure } from "./init";

// Resolve the caller's Producer.id once per call. Throws UNAUTHORIZED
// if no userId in context (caller didn't sign in), or NOT_FOUND if the
// Clerk user has no Producer row yet (webhook race — see onboarding).
//
// Lives in its own module (rather than inside `routers/portfolio.ts`)
// because every producer-scoped router needs the same middleware.
export const producerProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.clerkUserId, ctx.userId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "producer not provisioned" });
  return next({ ctx: { ...ctx, producerId: row.id, db } });
});
