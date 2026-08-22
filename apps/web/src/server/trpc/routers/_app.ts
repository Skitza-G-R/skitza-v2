import { router } from "../init";
import { artistRouter } from "./artist";
import { artistPlatformRouter } from "./artist-platform";
import { activeWorkImportRouter } from "./active-work-import";
import { audioRouter } from "./audio";
import { audioDeliveryRouter } from "./audio-delivery";
import { bookingRouter } from "./booking";
import { clientContactsRouter } from "./client-contacts";
import { healthRouter } from "./health";
import { googleCalendarRouter } from "./google-calendar";
import { firstVersionUploadRouter } from "./first-version-upload";
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
import { songArtworkRouter } from "./song-artwork";

export const appRouter = router({
  activeWorkImport: activeWorkImportRouter,
  artist: artistRouter,
  artistPlatform: artistPlatformRouter,
  audioDelivery: audioDeliveryRouter,
  audio: audioRouter,
  booking: bookingRouter,
  clientContacts: clientContactsRouter,
  health: healthRouter,
  googleCalendar: googleCalendarRouter,
  firstVersionUpload: firstVersionUploadRouter,
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
  songArtwork: songArtworkRouter,
});

export type AppRouter = typeof appRouter;
