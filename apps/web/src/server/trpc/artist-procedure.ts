import { TRPCError } from "@trpc/server";
import { createDb } from "@skitza/db";
import { publicProcedure } from "./init";

// Resolves the caller's Clerk user id and DB handle. Unlike
// producerProcedure, we DON'T require a producers row — the artist
// might be brand new (no studio relationships yet) and we still want
// to render the welcome screen for them.
//
// What we DO require: a Clerk session. Anonymous traffic doesn't
// belong here.
export const artistProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const db = createDb(dbUrl);
  return next({ ctx: { ...ctx, db, clerkUserId: ctx.userId } });
});
