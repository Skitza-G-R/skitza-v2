import { describe, it, expect } from "vitest";
import { appRouter } from "./_app";

describe("health.check", () => {
  it("returns ok=true with a version string", async () => {
    const caller = appRouter.createCaller({});
    const result = await caller.health.check();
    expect(result.ok).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
