import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { auth } from "~/server/auth/clerk-identity";
import { createDb } from "@skitza/db";
import type { Context } from "~/server/trpc/init";
import { appRouter } from "~/server/trpc/routers/_app";
import { isAccountClosureStarted } from "~/server/auth/account-access";

const handler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async (): Promise<Context> => {
      const { userId, providerUserId } = await auth();
      if (!userId) return { userId: null, providerUserId: null, accountClosureStarted: false };
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) throw new Error("missing DATABASE_URL");
      return {
        userId,
        providerUserId,
        accountClosureStarted: await isAccountClosureStarted(createDb(dbUrl), userId),
      };
    },
  });

export { handler as GET, handler as POST };
