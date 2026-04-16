import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Context } from "~/server/trpc/init";
import { appRouter } from "~/server/trpc/routers/_app";

const handler = (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: (): Context => ({}),
  });

export { handler as GET, handler as POST };
