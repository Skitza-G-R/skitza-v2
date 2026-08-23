import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SK-258: the Neon database (skitza-v3) lives in aws-eu-central-1 (Frankfurt).
// Vercel's default function region is iad1 (Washington DC), which made every
// database round trip cross the Atlantic. The Vercel project's root directory
// is apps/web, so this is the vercel.json the deployment actually reads.
describe("SK-258 Vercel function region", () => {
  it("runs functions in Frankfurt, next to the database", () => {
    const config = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8"),
    ) as { regions?: string[] };
    expect(config.regions).toEqual(["fra1"]);
  });
});
