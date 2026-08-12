import { TRPCError } from "@trpc/server";
import { createDb, eq, producers } from "@skitza/db";
import { publicProcedure } from "./init";

type ProducerContext = {
  db: ReturnType<typeof createDb>;
  producerId: string;
};

type ProducerContextCacheEntry = {
  userId: string;
  promise: Promise<ProducerContext>;
};

// Every tRPC request/caller owns its context object. Keeping the pending
// resolution against that object deduplicates parallel procedures without
// sharing producer authorization across requests, callers, or users.
const producerContextByCaller = new WeakMap<object, ProducerContextCacheEntry>();

async function loadProducerContext(userId: string): Promise<ProducerContext> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const db = createDb(dbUrl);
  const [row] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "producer not provisioned" });
  return { db, producerId: row.id };
}

function resolveProducerContext(ctx: object, userId: string): Promise<ProducerContext> {
  const cached = producerContextByCaller.get(ctx);
  if (cached?.userId === userId) return cached.promise;

  const promise = loadProducerContext(userId);
  const entry: ProducerContextCacheEntry = { userId, promise };
  producerContextByCaller.set(ctx, entry);
  void promise.catch(() => {
    // A transient DB/provisioning failure must not poison later calls made
    // through the same caller context.
    if (producerContextByCaller.get(ctx) === entry) {
      producerContextByCaller.delete(ctx);
    }
  });
  return promise;
}

// Resolve the caller's Producer.id once per request/caller context. Throws
// UNAUTHORIZED if no userId in context (caller didn't sign in), or NOT_FOUND
// if the Clerk user has no Producer membership.
//
// Lives in its own module (rather than inside `routers/portfolio.ts`)
// because every producer-scoped router needs the same middleware.
export const producerProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const producerContext = await resolveProducerContext(ctx, ctx.userId);
  return next({ ctx: { ...ctx, ...producerContext } });
});
