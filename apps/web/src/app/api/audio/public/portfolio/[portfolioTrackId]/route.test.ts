import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("retired legacy portfolio audio route", () => {
  it("fails every old copied-audio URL closed without metadata", async () => {
    const response = GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    await expect(response.text()).resolves.toBe("Not found");
  });
});
