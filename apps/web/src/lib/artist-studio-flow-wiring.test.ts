import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const source = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("trusted artist studio continuity", () => {
  it("threads the owned Store studio into product and private-offer detail links", () => {
    const store = source("app", "(artist)", "artist", "store", "page.tsx");
    const focal = source("components", "artist", "store", "focal-product-card.tsx");
    const quiet = source("components", "artist", "store", "quiet-product-list.tsx");
    const offers = source("components", "artist", "offers", "private-offers-list.tsx");

    expect(store).toContain("studioId={activeStudio.producerId}");
    expect(focal).toContain("withArtistStudio(productHref(product), studioId)");
    expect(quiet).toContain("withArtistStudio(productHref(product), studioId)");
    expect(offers).toContain("withArtistStudio(");
    expect(offers).toContain("offer.producerId");
  });

  it("uses trusted product, request, offer, and payment ownership for later screens", () => {
    const productPage = source("app", "(artist)", "artist", "purchase", "[productId]", "page.tsx");
    const sentPage = source(
      "app",
      "(artist)",
      "artist",
      "purchase",
      "[productId]",
      "sent",
      "page.tsx",
    );
    const payPage = source(
      "app",
      "(artist)",
      "artist",
      "purchase",
      "[productId]",
      "pay",
      "page.tsx",
    );
    const agreePage = source(
      "app",
      "(artist)",
      "artist",
      "purchase",
      "[productId]",
      "agree",
      "page.tsx",
    );
    const offerPage = source("app", "(artist)", "artist", "offers", "[offerId]", "page.tsx");
    const paymentPage = source(
      "app",
      "(artist)",
      "artist",
      "payments",
      "[purchaseId]",
      "page.tsx",
    );

    expect(productPage).toContain("studioId={row.producerId}");
    expect(sentPage).toContain("studioId={request.producerId}");
    expect(payPage).toContain("studioId={data.producerId}");
    expect(agreePage).toContain("studioId={preview.producerId}");
    expect(offerPage).toContain("studioId={offer.producerId}");
    expect(paymentPage).toContain("const studioId = purchase.studioId");
    expect(paymentPage).toContain("studioId={studioId}");
  });

  it("validates Book query state against owned studios but keeps an owned reschedule producer", () => {
    const book = source("app", "(artist)", "artist", "book", "page.tsx");

    expect(book).toMatch(
      /import\s*\{[^}]*resolveArtistStudioId[^}]*\}\s*from\s*"~\/lib\/artist-studio-context"/,
    );
    expect(book).toMatch(
      /rescheduleSession\?\.producerId\s*\?\?\s*resolveArtistStudioId\(\s*studios,\s*requestedStudioId,\s*savedStudioId,?\s*\)/,
    );
  });

  it("keeps studio context on professional Home, shared artist music links, and payment actions", () => {
    const home = source("app", "(artist)", "artist", "page.tsx");
    const library = source("components", "music", "library-screen.tsx");
    const project = source("components", "music", "project-page.tsx");
    const song = source("components", "music", "song-page.tsx");
    const payments = source("components", "payments", "payment-history.tsx");

    expect(home).toContain(
      "caller.artist.home({ producerId: activeStudio.producerId })",
    );
    expect(home).toContain(
      "caller.artist.book.mySessions({ producerId: activeStudio.producerId })",
    );
    expect(home).toContain(
      ".filter((project) => project.producerId === activeStudio.producerId)",
    );
    expect(home).toContain(
      "withArtistStudio(`/artist/payments/${purchase.id}`, activeStudio.producerId)",
    );
    expect(home).toContain("<ProfessionalArtistHome");
    expect(library).toContain("withArtistStudio");
    expect(project).toContain("withArtistStudio");
    expect(song).toContain("withArtistStudio");
    expect(payments).toContain("withArtistStudio");
  });

  it("keeps the owning studio through Home, Book, Sessions, and no-charge song journeys", () => {
    const artistRouter = source("server", "trpc", "routers", "artist.ts");
    const home = source("app", "(artist)", "artist", "page.tsx");
    const bookPage = source("app", "(artist)", "artist", "book", "page.tsx");
    const bookingClient = source("app", "(artist)", "artist", "book", "booking-client.tsx");
    const sessionsPage = source("app", "(artist)", "artist", "sessions", "page.tsx");
    const sessionsScreen = source("components", "artist", "sessions", "my-sessions-screen.tsx");
    const sessionRow = source("components", "artist", "sessions", "session-row.tsx");
    const sessionDetail = source("components", "artist", "sessions", "session-detail-screen.tsx");
    const noChargeDomain = source("server", "domain", "song-spaces", "no-charge.ts");
    const noChargeAgreement = source("components", "music", "no-charge-song-agreement.tsx");

    expect(artistRouter).toMatch(
      /nextSessionRows[\s\S]*producerId:\s*bookings\.producerId[\s\S]*const nextSession/,
    );
    expect(artistRouter).toMatch(/const nextSession[\s\S]*producerId:\s*nextRow\.producerId/);
    expect(home).toContain(
      "withArtistStudio(`/artist/sessions/${home.nextSession.id}`, activeStudio.producerId)",
    );
    expect(home).toMatch(
      /withArtistStudio\(\s*`\/artist\/book\?allowance=\$\{allowance\.sessionAllowanceId\}`,\s*activeStudio\.producerId,\s*\)/,
    );

    expect(bookPage).toContain("<BookEyebrow studioId={activeStudioId} />");
    expect(bookPage).toContain('withArtistStudio("/artist/sessions", studioId)');
    expect(bookingClient).toContain(
      "withArtistStudio(`/artist/sessions?just=${response.id}`, activeStudioId)",
    );
    expect(bookingClient.match(/withArtistStudio\("\/artist\/store", activeStudioId\)/g)).toHaveLength(
      1,
    );

    expect(sessionsPage).toContain(
      "resolveArtistStudioId(studios, sp.studio, savedStudioId)",
    );
    expect(sessionsPage).toContain(
      "caller.artist.book.mySessions({ producerId })",
    );
    expect(sessionsScreen).toContain("allowanceBookHref(bookableAllowance)");
    expect(sessionsScreen).toContain('withArtistStudio("/artist/store", studioId)');
    expect(sessionRow).toContain(
      "withArtistStudio(`/artist/sessions/${session.id}`, session.producerId)",
    );
    expect(sessionDetail).toContain(
      'withArtistStudio("/artist/sessions", session.producerId)',
    );
    expect(sessionDetail).toContain(
      "router.push(`/artist/sessions/${session.id}/reschedule`)",
    );
    expect(sessionDetail).toContain(
      "router.push(`/artist/sessions/${session.id}/cancel`)",
    );

    expect(noChargeDomain).toContain("producerId: payload.producerId");
    expect(noChargeAgreement.match(/withArtistStudio\([\s\S]*preview\.producerId/g)).not.toBeNull();
  });
});
