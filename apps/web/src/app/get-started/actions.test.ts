import { describe, expect, it } from "vitest";

import { submitWaitlist } from "./actions";

describe("retired waitlist action", () => {
  it("never submits public data after the waitlist is retired", async () => {
    await expect(submitWaitlist({ email: "artist@example.test", locale: "en" })).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
      message: "This signup list is no longer available.",
    });
  });
});
