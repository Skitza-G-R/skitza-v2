import { initTRPC } from "@trpc/server";
import superjson from "superjson";

export interface Context {
  // Future: userId?: string from Clerk auth(); db: Db; etc.
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
