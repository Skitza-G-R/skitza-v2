import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "..", "page.tsx"), "utf8");
const clientSource = readFileSync(join(here, "..", "booking-client.tsx"), "utf8");

describe("artist booking allowance-authored availability wiring", () => {
  it("loads new-booking availability for the server-validated selected allowance", () => {
    const availabilityCall = pageSource.slice(
      pageSource.indexOf("caller.artist.book.availability"),
      pageSource.indexOf(");", pageSource.indexOf("caller.artist.book.availability")) + 2,
    );

    expect(availabilityCall).toContain("producerId: activeStudioId");
    expect(availabilityCall).toContain("sessionAllowanceId:");
    expect(availabilityCall).toContain("initialSessionAllowanceId");
    expect(availabilityCall).toMatch(/bookingId:\s*rescheduleSession(?:\?\.)?\.id/);
  });

  it("updates the allowance URL when the picker changes so the server refreshes availability", () => {
    expect(clientSource).toMatch(/(?:params\.set\(["']allowance["'],\s*id\)|allowance:\s*id)/);
    expect(clientSource).toMatch(/router\.(?:replace|push)\([^)]*params\.toString\(\)/s);
  });

  it("never combines a newly selected allowance with stale server availability", () => {
    expect(clientSource).toMatch(
      /selectedPackage && selectedSessionAllowanceId === initialSessionAllowanceId/,
    );
    expect(pageSource).toMatch(
      /key=\{`\$\{activeStudioId\}:\$\{initialSessionAllowanceId \?\? "none"\}:\$\{rescheduleSession\?\.id \?\? "new"\}`\}/,
    );
  });
});
