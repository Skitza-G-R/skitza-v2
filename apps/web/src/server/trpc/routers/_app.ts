import { router } from "../init";
import { healthRouter } from "./health";
import { magicLinkRouter } from "./magic-link";
import { portfolioRouter } from "./portfolio";

export const appRouter = router({
  health: healthRouter,
  magicLink: magicLinkRouter,
  portfolio: portfolioRouter,
});

export type AppRouter = typeof appRouter;
