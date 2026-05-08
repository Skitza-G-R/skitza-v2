import { router } from "../init";
import { artistRouter } from "./artist";
import { audioRouter } from "./audio";
import { bookingRouter } from "./booking";
import { clientContactsRouter } from "./client-contacts";
import { healthRouter } from "./health";
import { inboxRouter } from "./inbox";
import { libraryRouter } from "./library";
import { paletteRouter } from "./palette";
import { paymentRouter } from "./payment";
import { portfolioRouter } from "./portfolio";
import { producerRouter } from "./producer";
import { producerExternalLinksRouter } from "./producer-external-links";
import { producerNotesRouter } from "./producer-notes";
import { projectRouter } from "./project";
import { publicProfileRouter } from "./public-profile";
import { stripeRouter } from "./stripe";
import { waitlistRouter } from "./waitlist";

export const appRouter = router({
  artist: artistRouter,
  audio: audioRouter,
  booking: bookingRouter,
  clientContacts: clientContactsRouter,
  health: healthRouter,
  inbox: inboxRouter,
  library: libraryRouter,
  palette: paletteRouter,
  payment: paymentRouter,
  portfolio: portfolioRouter,
  producer: producerRouter,
  producerExternalLinks: producerExternalLinksRouter,
  producerNotes: producerNotesRouter,
  project: projectRouter,
  publicProfile: publicProfileRouter,
  stripe: stripeRouter,
  waitlist: waitlistRouter,
});

export type AppRouter = typeof appRouter;
