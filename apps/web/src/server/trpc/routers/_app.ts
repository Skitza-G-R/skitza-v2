import { router } from "../init";
import { artistRouter } from "./artist";
import { audioRouter } from "./audio";
import { bookingRouter } from "./booking";
import { clientContactsRouter } from "./client-contacts";
import { contractRouter } from "./contract";
import { healthRouter } from "./health";
import { inboxRouter } from "./inbox";
import { libraryRouter } from "./library";
import { magicLinkRouter } from "./magic-link";
import { paletteRouter } from "./palette";
import { portfolioRouter } from "./portfolio";
import { producerRouter } from "./producer";
import { projectRouter } from "./project";
import { stripeRouter } from "./stripe";

export const appRouter = router({
  artist: artistRouter,
  audio: audioRouter,
  booking: bookingRouter,
  clientContacts: clientContactsRouter,
  contract: contractRouter,
  health: healthRouter,
  inbox: inboxRouter,
  library: libraryRouter,
  magicLink: magicLinkRouter,
  palette: paletteRouter,
  portfolio: portfolioRouter,
  producer: producerRouter,
  project: projectRouter,
  stripe: stripeRouter,
});

export type AppRouter = typeof appRouter;
