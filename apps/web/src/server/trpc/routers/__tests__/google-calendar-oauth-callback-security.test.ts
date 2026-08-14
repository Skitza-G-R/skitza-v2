import { describe, expect, it } from "vitest";

import { googleCalendarRouter } from "../google-calendar";

describe("Google Calendar OAuth callback tRPC boundary", () => {
  it("does not expose the sessionless callback as a public tRPC procedure", () => {
    expect(Object.keys(googleCalendarRouter._def.procedures)).not.toContain(
      "oauth.completeCallback",
    );
  });

  it("keeps direct tRPC completion behind producer authentication", async () => {
    const caller = googleCalendarRouter.createCaller({ userId: null });

    await expect(
      caller.oauth.complete({
        stateToken: "signed-state",
        code: "provider-code",
        browserBinding: "a".repeat(43),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
