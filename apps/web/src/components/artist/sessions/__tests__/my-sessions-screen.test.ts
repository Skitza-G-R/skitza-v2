import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const screenSrc = readFileSync(join(here, "..", "my-sessions-screen.tsx"), "utf8");
const rowSrc = readFileSync(join(here, "..", "session-row.tsx"), "utf8");
const pageSrc = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(artist)", "artist", "sessions", "page.tsx"),
  "utf8",
);

describe("artist Sessions standing hub", () => {
  it("stays in the artist shell", () => {
    expect(screenSrc).toMatch(/^"use client";/);
    expect(screenSrc).not.toMatch(/fixed inset-0/);
    expect(screenSrc).not.toMatch(/FunnelTopBar/);
  });

  it("groups server sessions as Next, Held requests, Upcoming, and Past", () => {
    expect(screenSrc).toMatch(/groupArtistSessions/);
    expect(screenSrc).toMatch(/const next = confirmed\[0\]/);
    expect(screenSrc).toMatch(/status === "pending_approval"/);
    for (const title of ["Next", "Held requests", "Upcoming", "Past"]) {
      expect(screenSrc).toContain(`title="${title}"`);
    }
    expect(screenSrc).toMatch(/nowISO/);
  });

  it("shows Book only for a real entitlement and otherwise View services", () => {
    expect(screenSrc).toMatch(/allowances\.find\(allowanceCanBook\)/);
    expect(screenSrc).toMatch(/allowanceBookHref\(bookableAllowance\)/);
    expect(screenSrc).toMatch(/withArtistStudio\("\/artist\/store"/);
    expect(screenSrc).toMatch(/"Book a session" : "View services"/);
  });

  it("shows confirmation only for an explicit active just-booked session", () => {
    expect(screenSrc).toMatch(/searchParams\.get\("just"\)/);
    expect(screenSrc).toMatch(/session\.id === justId/);
    expect(screenSrc).toMatch(/<ConfirmationHero/);
  });

  it("uses the shared row and five-label status pill", () => {
    expect(screenSrc).toMatch(/<SessionRow/);
    expect(rowSrc).toMatch(/<StatusPill/);
  });

  it("shows why an automatically expired Held request was cancelled", () => {
    expect(pageSrc).toMatch(/heldExpiryReason: session\.heldExpiryReason/);
    expect(rowSrc).toContain("The studio did not confirm this request in time.");
    expect(rowSrc).toMatch(/heldExpiryReason === "approval_timeout"/);
  });

  it("renders date and time in the artist's global timezone", () => {
    expect(rowSrc).toMatch(/monthShort\(session\.startsAtISO, session\.artistTimezone\)/);
    expect(rowSrc).toMatch(/dayNumber\(session\.startsAtISO, session\.artistTimezone\)/);
    expect(rowSrc).toMatch(/formatSessionTime\(session\.startsAtISO, session\.artistTimezone\)/);
  });
});

describe("Sessions route read model", () => {
  it("resolves and scopes the selected studio", () => {
    expect(pageSrc).toMatch(/resolveArtistStudioId/);
    expect(pageSrc).toMatch(/caller\.artist\.book\.mySessions\(\{ producerId \}\)/);
    expect(pageSrc).toMatch(/searchParams/);
  });

  it("passes deterministic server time and real rows with no mock fallback", () => {
    expect(pageSrc).toMatch(/result\.sessions\.map/);
    expect(pageSrc).toMatch(/result\.allowances\.map/);
    expect(pageSrc).toMatch(/nowISO=\{new Date\(\)\.toISOString\(\)\}/);
    expect(pageSrc).not.toMatch(/MOCK_/);
  });
});
