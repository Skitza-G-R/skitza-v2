import { describe, it, expect } from "vitest";
import { APP_VERSION, isProduction } from "./version";

describe("version module", () => {
  it("exports a semver-shaped APP_VERSION string", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("isProduction is false in test environment", () => {
    expect(isProduction()).toBe(false);
  });
});
