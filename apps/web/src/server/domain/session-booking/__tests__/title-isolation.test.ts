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
  it("keeps stored and manual booking titles purchase-derived", () => {
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

    expect(manualSource).toContain("defaultTitle: productName");
    expect(manualSource).toContain("defaultTitle: entitlement?.defaultTitle ?? null");
    expect(manualSource).toContain(
      "const title = (input.title ?? entitlement.defaultTitle).trim()",
    );
    expect(manualSource).not.toContain("const title = (input.title ?? project.title).trim()");
  });

  it("uses the stored session title for both ICS and Google delivery", () => {
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
    expect(googlePayload).toContain(
      "return booking.title?.trim() || context.purchase.defaultSessionTitle",
    );
    expect(googlePayload).toContain(
      'summary: confirmed ? confirmedGoogleCalendarSummary(input.context, input.booking) : "Reserved"',
    );
    expect(googlePayload).not.toContain("context.project.title.trim()");
  });
});
