import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { auth } from "@clerk/nextjs/server";
import type { Context } from "~/server/trpc/init";
import { appRouter } from "~/server/trpc/routers/_app";

const handler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async (): Promise<Context> => {
      const { userId } = await auth();
      return { userId };
    },
  });

export { handler as GET, handler as POST };
