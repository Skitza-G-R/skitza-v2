import { describe, expect, it } from "vitest";

import { kindToTile } from "../kind-to-tile";

describe("kindToTile", () => {
  it.each([
    ["mix", "mix"],
    ["mixing", "mix"],
    ["master", "master"],
    ["mastering", "master"],
    ["production", "production"],
    ["producing", "production"],
    ["album", "production"],
    ["consult", "consult"],
    ["session", "consult"],
    ["other", "consult"],
    ["custom", "consult"],
    ["hourly", "consult"],
    ["beat_lease", "consult"],
  ])("maps kind %s to tile %s", (kind, tile) => {
    expect(kindToTile(kind)).toBe(tile);
  });

  it("falls back to consult for unknown kinds", () => {
    expect(kindToTile("zzz_unknown")).toBe("consult");
    expect(kindToTile("")).toBe("consult");
  });

  it("handles uppercase input case-insensitively", () => {
    expect(kindToTile("MIX")).toBe("mix");
    expect(kindToTile("Production")).toBe("production");
  });
});
