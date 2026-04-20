import { describe, expect, it } from "vitest";

import { nextSaveStatus, type SaveStatus } from "../save-indicator";

describe("nextSaveStatus transitions", () => {
  it("enters saving when the signal flips to saving=true", () => {
    expect(nextSaveStatus("idle", { saving: true })).toBe("saving");
    expect(nextSaveStatus("saved", { saving: true })).toBe("saving");
  });

  it("flashes saved only when the previous state was saving", () => {
    expect(nextSaveStatus("saving", { saving: false })).toBe("saved");
    // No prior saving state → no unprompted "Saved ✓".
    expect(nextSaveStatus("idle", { saving: false })).toBe("idle");
    expect(nextSaveStatus("saved", { saving: false })).toBe("saved");
  });

  it("promotes to error whenever error is present, regardless of prior state", () => {
    const prevStates: SaveStatus[] = ["idle", "saving", "saved", "error"];
    for (const prev of prevStates) {
      expect(nextSaveStatus(prev, { saving: false, error: "oops" })).toBe("error");
      expect(nextSaveStatus(prev, { saving: true, error: "oops" })).toBe("error");
    }
  });

  it("treats a null/missing error as absent", () => {
    expect(nextSaveStatus("saving", { saving: false, error: null })).toBe("saved");
    expect(nextSaveStatus("saving", { saving: false })).toBe("saved");
    // Empty string is "truthy enough to be an error" — we treat falsy
    // strictly, so an empty string still doesn't trip the error state.
    expect(nextSaveStatus("saving", { saving: false, error: "" })).toBe("saved");
  });
});
