import { router } from "../init";
import { audioRouter } from "./audio";
import { bookingRouter } from "./booking";
import { contractRouter } from "./contract";
import { dealRouter } from "./deal";
import { healthRouter } from "./health";
import { magicLinkRouter } from "./magic-link";
import { portfolioRouter } from "./portfolio";
import { producerRouter } from "./producer";

export const appRouter = router({
  audio: audioRouter,
  booking: bookingRouter,
  contract: contractRouter,
  deal: dealRouter,
  health: healthRouter,
  magicLink: magicLinkRouter,
  portfolio: portfolioRouter,
  producer: producerRouter,
});

export type AppRouter = typeof appRouter;
