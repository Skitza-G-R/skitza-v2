import { router } from "../init";
import { artistRouter } from "./artist";
import { audioRouter } from "./audio";
import { audioDeliveryRouter } from "./audio-delivery";
import { bookingRouter } from "./booking";
import { clientContactsRouter } from "./client-contacts";
import { healthRouter } from "./health";
import { inboxRouter } from "./inbox";
import { libraryRouter } from "./library";
import { paletteRouter } from "./palette";
import { portfolioRouter } from "./portfolio";
import { producerRouter } from "./producer";
import { producerExternalLinksRouter } from "./producer-external-links";
import { producerNotesRouter } from "./producer-notes";
import { projectRouter } from "./project";
import { pushRouter } from "./push";
import { privateOffersRouter } from "./private-offers";
import { purchaseLedgerRouter } from "./purchase-ledger";
import { publicProfileRouter } from "./public-profile";
import { songPublicationRouter } from "./song-publication";
import { waitlistRouter } from "./waitlist";

export const appRouter = router({
  artist: artistRouter,
  audioDelivery: audioDeliveryRouter,
  audio: audioRouter,
  booking: bookingRouter,
  clientContacts: clientContactsRouter,
  health: healthRouter,
  inbox: inboxRouter,
  library: libraryRouter,
  palette: paletteRouter,
  portfolio: portfolioRouter,
  producer: producerRouter,
  producerExternalLinks: producerExternalLinksRouter,
  producerNotes: producerNotesRouter,
  project: projectRouter,
  push: pushRouter,
  privateOffers: privateOffersRouter,
  purchaseLedger: purchaseLedgerRouter,
  publicProfile: publicProfileRouter,
  songPublication: songPublicationRouter,
  waitlist: waitlistRouter,
});

export type AppRouter = typeof appRouter;
