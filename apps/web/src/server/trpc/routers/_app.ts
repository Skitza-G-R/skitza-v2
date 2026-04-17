import { router } from "../init";
import { bookingRouter } from "./booking";
import { healthRouter } from "./health";
import { magicLinkRouter } from "./magic-link";
import { portfolioRouter } from "./portfolio";
import { producerRouter } from "./producer";

export const appRouter = router({
  booking: bookingRouter,
  health: healthRouter,
  magicLink: magicLinkRouter,
  portfolio: portfolioRouter,
  producer: producerRouter,
});

export type AppRouter = typeof appRouter;
