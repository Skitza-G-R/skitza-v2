import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const dbSource = readFileSync(join(here, "..", "db.ts"), "utf8");
const manualSource = readFileSync(join(here, "..", "manual.ts"), "utf8");
const serviceSource = readFileSync(join(here, "..", "service.ts"), "utf8");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("session title isolation", () => {
  it("defaults stored and manual booking titles to the project, artist, and producer", () => {
    const createContext = between(
      dbSource,
      "function createContextFromRow(",
      "function transactionAdapter(",
    );
    expect(createContext).toContain(
      `defaultSessionTitle:
        row.purchaseCommercialSnapshot?.productOrOfferName.trim() ||
        row.projectTitle.trim() ||
        "Session"`,
    );
    expect(createContext).toContain('title: row.projectTitle.trim() || "Session"');

    expect(manualSource).toContain("displayName: producers.displayName");
    expect(manualSource).toContain("artistName: clientContacts.name");
    expect(manualSource).toContain("defaultTitle: entitlement");
    expect(manualSource).toContain("formatSessionIdentityTitle({");
    expect(manualSource).toContain("projectName: project.title");
    expect(manualSource).toContain("artistName: project.artistName");
    expect(manualSource).toContain("producerName: producer.displayName");
    expect(manualSource).toContain(
      'const title = (input.title ?? project.defaultTitle ?? "").trim()',
    );

    const createBooking = between(
      serviceSource,
      "async function createSessionBookingInTransaction(",
      "export async function createSessionBooking(",
    );
    expect(createBooking).toContain("formatSessionIdentityTitle({");
    expect(createBooking).toContain("projectName: context.project.title");
    expect(createBooking).toContain("artistName: context.artist.name");
    expect(createBooking).toContain("producerName: context.producer.name");
  });

  it("uses the session identity title for both ICS and Google Calendar", () => {
    const icsPayload = between(
      serviceSource,
      "function icsCalendarSyncPayload(",
      "function canonicalJson(",
    );
    const googlePayload = between(
      serviceSource,
      "function confirmedGoogleCalendarSummary(",
      "async function enqueueBookingCalendarJob(",
    );

    expect(icsPayload).toContain(
      "summary: input.booking.title?.trim() || input.context.purchase.defaultSessionTitle",
    );
    expect(icsPayload).not.toContain("confirmedGoogleCalendarSummary");
    expect(googlePayload).toContain("booking.title?.trim()");
    expect(googlePayload).toContain("formatSessionIdentityTitle({");
    expect(googlePayload).toContain("projectName: context.project.title");
    expect(googlePayload).toContain("artistName: booking.artistName || context.artist.name");
    expect(googlePayload).toContain("producerName: context.producer.name");
    expect(googlePayload).toContain(
      'summary: confirmed ? confirmedGoogleCalendarSummary(input.context, input.booking) : "Reserved"',
    );
  });
});
