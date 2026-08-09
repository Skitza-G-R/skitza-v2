import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

describe("Google Calendar page rollout gate", () => {
  it("omits the optional control unless the server-only capability is configured", () => {
    expect(pageSource).toContain("isGoogleCalendarServerConfigured()");
    expect(pageSource).toContain("caller.googleCalendar.status().catch(() => null)");
    expect(pageSource).toContain(
      "const googleCalendarModel = googleStatus ? presentGoogleCalendar(googleStatus) : null;",
    );
    expect(pageSource).toContain("googleCalendarControl={");
    expect(pageSource).toContain("googleCalendarModel ? (");
    expect(pageSource).not.toContain("NEXT_PUBLIC_GOOGLE");
  });
});
