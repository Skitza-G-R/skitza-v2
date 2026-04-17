import { router } from "../init";
import { bookingRouter } from "./booking";
import { contractRouter } from "./contract";
import { healthRouter } from "./health";
import { magicLinkRouter } from "./magic-link";
import { portfolioRouter } from "./portfolio";
import { producerRouter } from "./producer";
import { projectRouter } from "./project";

export const appRouter = router({
  booking: bookingRouter,
  contract: contractRouter,
  health: healthRouter,
  magicLink: magicLinkRouter,
  portfolio: portfolioRouter,
  producer: producerRouter,
  project: projectRouter,
});

export type AppRouter = typeof appRouter;
