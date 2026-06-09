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

const screenSrc = readFileSync(SCREEN_PATH, "utf8");
const headerSrc = readFileSync(HEADER_PATH, "utf8");
const rowSrc = readFileSync(ROW_PATH, "utf8");
const emptySrc = readFileSync(EMPTY_PATH, "utf8");
const heroSrc = readFileSync(HERO_PATH, "utf8");

describe("my-sessions-screen.tsx (S11) wiring", () => {
  it("is a client component (taps + router navigation)", () => {
    expect(screenSrc).toMatch(/^"use client";/);
  });

  it("sources its data types from the shared book-data module", () => {
    expect(screenSrc).toMatch(/from\s+["']\.\/book-data["']/);
    expect(screenSrc).toMatch(/SessionListItem/);
    expect(screenSrc).toMatch(/ActiveBooking/);
  });

  it("renders the active-booking header", () => {
    expect(screenSrc).toMatch(/<ActiveBookingHeader/);
  });

  it("renders the confirmation hero for the just-booked / latest session", () => {
    expect(screenSrc).toMatch(/<ConfirmationHero/);
    // driven by a ?just=<id> searchParam or the most-recent held/confirmed
    expect(screenSrc).toMatch(/just/);
  });

  it("uses the shared StatusPill (via SessionRow)", () => {
    expect(rowSrc).toMatch(/StatusPill/);
    expect(rowSrc).toMatch(/<StatusPill/);
  });

  it("routes each row to /artist/sessions/<id>", () => {
    expect(rowSrc).toMatch(/router\.push\(`\/artist\/sessions\/\$\{[^}]+\}`\)/);
  });

  it("renders the empty state when there are no sessions", () => {
    expect(screenSrc).toMatch(/<SessionsEmpty/);
    expect(screenSrc).toMatch(/sessions\.length\s*===\s*0/);
  });

  it("guards 'Book another session' on activeBooking.canBookAnother", () => {
    expect(screenSrc).toMatch(/activeBooking\.canBookAnother/);
    expect(screenSrc).toMatch(/Book another session/);
    expect(screenSrc).toMatch(/\/artist\/book/);
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
});

describe("sessions-empty.tsx wiring", () => {
  it("links to the store (buying precedes booking)", () => {
    expect(emptySrc).toMatch(/href="\/artist\/store"/);
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

  it("offers the greyed 'Add to calendar' coming-soon chip", () => {
    expect(heroSrc).toMatch(/Add to calendar/);
  });
});
