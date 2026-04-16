import { initTRPC } from "@trpc/server";
import superjson from "superjson";

export interface Context {
  // TODO(task-7): db: NeonHttpDatabase from Drizzle.
  // TODO(task-8): userId: string | null from Clerk auth().
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
