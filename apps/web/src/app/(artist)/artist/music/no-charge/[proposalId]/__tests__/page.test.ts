import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeDir = join(__dirname, "..");

describe("no charge song agreement route", () => {
  it("previews and accepts only through the artist-authenticated project boundary", () => {
    const page = readFileSync(join(routeDir, "page.tsx"), "utf8");
    const actions = readFileSync(join(routeDir, "actions.ts"), "utf8");

    expect(page).toContain("project.noChargeProposal.preview");
    expect(actions).toContain("project.noChargeProposal.accept");
    expect(actions).toContain("createCaller({ userId })");
    expect(actions).not.toContain("producerProcedure");
    expect(page).toContain('error.code === "BAD_REQUEST"');
  });
});
