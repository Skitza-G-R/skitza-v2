import { router } from "../init";
import { audioRouter } from "./audio";
import { bookingRouter } from "./booking";
import { clientContactsRouter } from "./client-contacts";
import { contractRouter } from "./contract";
import { dealRouter } from "./deal";
import { healthRouter } from "./health";
import { inboxRouter } from "./inbox";
import { libraryRouter } from "./library";
import { magicLinkRouter } from "./magic-link";
import { paletteRouter } from "./palette";
import { portfolioRouter } from "./portfolio";
import { producerRouter } from "./producer";

export const appRouter = router({
  audio: audioRouter,
  booking: bookingRouter,
  clientContacts: clientContactsRouter,
  contract: contractRouter,
  deal: dealRouter,
  health: healthRouter,
  inbox: inboxRouter,
  library: libraryRouter,
  magicLink: magicLinkRouter,
  palette: paletteRouter,
  portfolio: portfolioRouter,
  producer: producerRouter,
});

export type AppRouter = typeof appRouter;
