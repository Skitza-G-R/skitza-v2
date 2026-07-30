import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homePage = readFileSync(join(__dirname, "../../page.tsx"), "utf8");
const storePage = readFileSync(join(__dirname, "../../store/page.tsx"), "utf8");
const detailPage = readFileSync(join(__dirname, "../[offerId]/page.tsx"), "utf8");
const offerActions = readFileSync(join(__dirname, "../actions.ts"), "utf8");
const srcRoot = join(__dirname, "../../../../..");
const artistRouter = readFileSync(join(srcRoot, "server/trpc/routers/artist.ts"), "utf8");
const appRouter = readFileSync(join(srcRoot, "server/trpc/routers/_app.ts"), "utf8");

describe("artist private-offer route wiring", () => {
  it("keeps offers out of the single-action Artist Home", () => {
    expect(homePage).toContain("caller.artist.home({ producerId:");
    expect(homePage).not.toContain("caller.privateOffers.artistList");
    expect(homePage).not.toContain("PrivateOffersList");
  });

  it("loads only the active studio's offers in Store", () => {
    expect(storePage).toContain(
      "caller.artist.store.products({ producerId: activeStudio.producerId })",
    );
    expect(storePage).toContain(
      "caller.privateOffers.artistList({ producerId: activeStudio.producerId })",
    );
    expect(storePage).toMatch(/<PrivateOffersList\s+offers=\{privateOffers\.offers\}/);
  });

  it("uses dedicated private-offer endpoints for detail, accept, and reject", () => {
    expect(detailPage).toContain("caller.privateOffers.artistGet({ offerId })");
    expect(detailPage).toContain("notFound()");
    expect(offerActions).toContain("caller.privateOffers.accept({");
    expect(offerActions).toContain("caller.privateOffers.reject({ offerId })");
  });

  it("mounts a separate router without putting offers into artist Music/home", () => {
    expect(appRouter).toContain('import { privateOffersRouter } from "./private-offers"');
    expect(appRouter).toContain("privateOffers: privateOffersRouter");
    expect(artistRouter).not.toMatch(/privateOffers|privateOffer/);
    expect(artistRouter).toContain("home: artistProcedure");
    expect(artistRouter).toContain("music: musicSubrouter");
  });
});
