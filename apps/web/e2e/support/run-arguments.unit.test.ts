import { describe, expect, it } from "vitest";

import { safePlaywrightArguments } from "./run-arguments";

describe("isolated browser runner arguments", () => {
  it("allows only the no-argument run and secret-safe test listing", () => {
    expect(safePlaywrightArguments([])).toEqual([]);
    expect(safePlaywrightArguments(["--list"])).toEqual(["--list"]);
  });

  it("rejects reporters, traces, screenshots, alternate configs, and arbitrary arguments", () => {
    for (const argv of [
      ["--trace", "on"],
      ["--screenshot", "on"],
      ["--reporter", "list"],
      ["--config", "other.config.ts"],
      ["--list", "--reporter", "list"],
      ["specs/private.spec.ts"],
    ]) {
      expect(() => safePlaywrightArguments(argv)).toThrow("SK102_BROWSER_ARGUMENT_FORBIDDEN");
    }
  });
});
