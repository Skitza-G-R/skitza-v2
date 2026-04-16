import { router } from "../init";
import { healthRouter } from "./health";
import { portfolioRouter } from "./portfolio";

export const appRouter = router({
  health: healthRouter,
  portfolio: portfolioRouter,
});

export type AppRouter = typeof appRouter;
