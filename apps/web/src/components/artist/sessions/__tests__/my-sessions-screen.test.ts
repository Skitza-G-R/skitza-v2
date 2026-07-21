import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep wiring tests for the S11 "My sessions" standing screen and its
// sub-components — matching the repo's existing test style (see
// commit-screens.test.ts + store-product-client.test.ts). No jsdom render.

const here = dirname(fileURLToPath(import.meta.url));
const SCREEN_PATH = join(here, "..", "my-sessions-screen.tsx");
const HEADER_PATH = join(here, "..", "active-booking-header.tsx");
const ROW_PATH = join(here, "..", "session-row.tsx");
const EMPTY_PATH = join(here, "..", "sessions-empty.tsx");
const HERO_PATH = join(here, "..", "confirmation-hero.tsx");
const PAGE_PATH = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "app",
  "(artist)",
  "artist",
  "sessions",
  "page.tsx",
);

const screenSrc = readFileSync(SCREEN_PATH, "utf8");
const headerSrc = readFileSync(HEADER_PATH, "utf8");
const rowSrc = readFileSync(ROW_PATH, "utf8");
const emptySrc = readFileSync(EMPTY_PATH, "utf8");
const heroSrc = readFileSync(HERO_PATH, "utf8");
const pageSrc = readFileSync(PAGE_PATH, "utf8");

describe("my-sessions-screen.tsx (S11) wiring", () => {
  it("is a client component (taps + router navigation)", () => {
    expect(screenSrc).toMatch(/^"use client";/);
  });

  it("sources its data types from the shared book-data module", () => {
    expect(screenSrc).toMatch(/from\s+["']\.\/book-data["']/);
    expect(screenSrc).toMatch(/SessionListItem/);
    expect(screenSrc).toMatch(/AllowanceSummary/);
  });

  it("renders one allowance header for every purchase-owned allowance", () => {
    expect(screenSrc).toMatch(/allowances\.map/);
    expect(screenSrc).toMatch(/<ActiveBookingHeader/);
  });

  it("renders the confirmation hero for the just-booked / latest session", () => {
    expect(screenSrc).toMatch(/<ConfirmationHero/);
    // driven by a ?just=<id> searchParam or the most-recent held/confirmed
    expect(screenSrc).toMatch(/just/);
    expect(screenSrc).toMatch(
      /match\.status === "pending_approval" \|\| match\.status === "confirmed"/,
    );
    expect(screenSrc).toMatch(/if \(justId\)[\s\S]*return null;/);
  });

  it("uses the shared StatusPill (via SessionRow)", () => {
    expect(rowSrc).toMatch(/StatusPill/);
    expect(rowSrc).toMatch(/<StatusPill/);
  });

  it("routes each row to /artist/sessions/<id>", () => {
    expect(rowSrc).toContain(
      "router.push(withArtistStudio(`/artist/sessions/${session.id}`, session.producerId))",
    );
  });

  it("renders both the row date and time in the producer timezone", () => {
    expect(rowSrc).toMatch(/monthShort\(session\.startsAtISO, session\.producerTimezone\)/);
    expect(rowSrc).toMatch(/dayNumber\(session\.startsAtISO, session\.producerTimezone\)/);
    expect(rowSrc).toMatch(/formatSessionTime\(session\.startsAtISO, session\.producerTimezone\)/);
  });

  it("uses the Store empty state only before the artist owns an allowance", () => {
    expect(screenSrc).toMatch(/<SessionsEmpty/);
    expect(screenSrc).toMatch(/sessions\.length\s*===\s*0/);
    expect(screenSrc).toMatch(/allowances\.length === 0/);
    expect(screenSrc).toMatch(/No sessions booked yet/);
  });

  it("guards 'Book another session' and preserves the exact allowance", () => {
    expect(screenSrc).toMatch(/allowanceCanBook\(allowance\)/);
    expect(screenSrc).toMatch(/allowanceBookHref\(allowance\)/);
    expect(screenSrc).toMatch(/Book another session/);
  });

  it("shows the 'My sessions.' eyebrow with font-syne + an amber dot", () => {
    expect(screenSrc).toMatch(/My sessions\./);
    expect(screenSrc).toMatch(/font-syne/);
  });
});

describe("active-booking-header.tsx wiring", () => {
  it("branches on all three progress modes (dots / bar / count)", () => {
    expect(headerSrc).toMatch(/progressMode/);
    expect(headerSrc).toMatch(/["']dots["']/);
    expect(headerSrc).toMatch(/["']bar["']/);
    expect(headerSrc).toMatch(/["']count["']/);
  });

  it("uses buildProgressDots for the dots mode", () => {
    expect(headerSrc).toMatch(/buildProgressDots/);
  });

  it("is an amber-tinted card", () => {
    expect(headerSrc).toMatch(/brand-primary/);
  });

  it("explains why an open-looking allowance cannot currently book", () => {
    expect(headerSrc).toMatch(/allowanceUnavailableMessage\(booking\)/);
    expect(pageSrc).toMatch(/bookingBlockedReason: allowance\.bookingBlockedReason/);
  });
});

describe("sessions-empty.tsx wiring", () => {
  it("links to the store (buying precedes booking)", () => {
    expect(emptySrc).toContain('href={withArtistStudio("/artist/store", studioId)}');
    expect(emptySrc).toMatch(/<Link/);
  });
});

describe("confirmation-hero.tsx wiring", () => {
  it("celebrates confirmed with the green CheckLarge emblem + 'You're booked'", () => {
    expect(heroSrc).toMatch(/CheckLarge/);
    expect(heroSrc).toMatch(/You.{0,3}re booked/);
    expect(heroSrc).toMatch(/fg-success/);
  });

  it("softens held with the amber ClockIcon tone + 'Holding this time'", () => {
    expect(heroSrc).toMatch(/ClockIcon/);
    expect(heroSrc).toMatch(/Holding this time/);
  });

  it("never presents a terminal session as newly held", () => {
    expect(heroSrc).toMatch(
      /session\.status !== "confirmed" && session\.status !== "pending_approval"/,
    );
  });

  it("does not render a dead calendar control", () => {
    expect(heroSrc).not.toMatch(/Add to calendar|Soon/);
  });
});

describe("My Sessions route data", () => {
  it("uses the real owned session read model and contains no mock fallback", () => {
    expect(pageSrc).toMatch(/caller\.artist\.book\.mySessions\(\)/);
    expect(pageSrc).not.toMatch(/MOCK_/);
    expect(pageSrc).toMatch(/result\.sessions\.map/);
    expect(pageSrc).toMatch(/result\.allowances\.map/);
  });
});
