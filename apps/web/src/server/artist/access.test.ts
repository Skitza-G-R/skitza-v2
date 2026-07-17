import { describe, expect, it } from "vitest";

import { assertArtistMusicProjectAvailable } from "./access";

describe("artist Music lifecycle access", () => {
  it("hides waiting projects but preserves listening access to later lifecycle states", () => {
    expect(() => {
      assertArtistMusicProjectAvailable("waiting_for_payment");
    }).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));

    for (const status of ["active", "paused", "completed", "canceled"] as const) {
      expect(() => {
        assertArtistMusicProjectAvailable(status);
      }).not.toThrow();
    }
  });
});
