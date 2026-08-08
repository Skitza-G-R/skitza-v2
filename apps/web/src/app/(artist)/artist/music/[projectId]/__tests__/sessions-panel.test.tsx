import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionsPanel, type SessionRow } from "../sessions-panel";

function session(id: string, startsAtIso: string, artistTimezone: string): SessionRow {
  return {
    id,
    startsAtIso,
    artistTimezone,
    producerTimezone: "Asia/Jerusalem",
    durationMin: 90,
    status: "confirmed",
    packageName: "Studio session",
  };
}

describe("Artist project session timezone presentation", () => {
  it("carries Artist and Studio timezones through the project query and page mapping", () => {
    const routerSource = readFileSync(
      join(process.cwd(), "src/server/trpc/routers/artist.ts"),
      "utf8",
    );
    const pageSource = readFileSync(
      join(process.cwd(), "src/app/(artist)/artist/music/[projectId]/page.tsx"),
      "utf8",
    );

    expect(routerSource).toMatch(
      /displayName:\s*producers\.displayName,\s*timezone:\s*producers\.timezone/,
    );
    expect(routerSource).toMatch(
      /producerName,\s*producerTimezone,\s*artistTimezone,\s*},\s*tracks,\s*sessions:/,
    );
    expect(pageSource).toMatch(/artistTimezone:\s*sessionData\.project\.artistTimezone/);
    expect(pageSource).toMatch(/producerTimezone:\s*sessionData\.project\.producerTimezone/);
  });

  it("keeps a cross-midnight instant on the Artist's local calendar day", () => {
    const html = renderToStaticMarkup(
      <SessionsPanel
        sessions={[session("summer", "2026-06-10T01:30:00.000Z", "America/New_York")]}
      />,
    );

    expect(html).toContain("Tue, Jun 9 · 9:30 PM");
    expect(html).toContain("America/New_York · GMT-4");
    expect(html).not.toContain("Wed, Jun 10");
  });

  it("derives the Artist's offset for each side of a DST transition", () => {
    const html = renderToStaticMarkup(
      <SessionsPanel
        sessions={[
          session("before-fallback", "2026-11-01T05:30:00.000Z", "America/New_York"),
          session("after-fallback", "2026-11-01T06:30:00.000Z", "America/New_York"),
        ]}
      />,
    );

    expect(html).toContain("America/New_York · GMT-4");
    expect(html).toContain("America/New_York · GMT-5");
  });
});
