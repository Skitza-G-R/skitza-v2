import { initTRPC } from "@trpc/server";
import superjson from "superjson";

export interface Context {
  userId: string | null;
  /** Raw signed Clerk id. Domain authorization must use userId instead. */
  providerUserId?: string | null;
  accountClosureStarted?: boolean;
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
