import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const readArtistRoute = (...parts: string[]) => readFileSync(join(here, "..", ...parts), "utf8");

describe("artist studio preference server wiring", () => {
  it.each([
    ["Home", readArtistRoute("page.tsx")],
    ["Music", readArtistRoute("music", "page.tsx")],
    ["Store", readArtistRoute("store", "page.tsx")],
    ["Book", readArtistRoute("book", "page.tsx")],
  ])("uses the saved studio for queryless %s requests", (_name, source) => {
    expect(source).toContain("readArtistStudioPreference(userId)");
    expect(source).toMatch(
      /resolveArtistStudioId\([\s\S]{0,160}(?:savedStudioId|savedStudioId\);)/,
    );
  });

  it("uses the same saved studio for the server-rendered shell", () => {
    const source = readArtistRoute("layout.tsx");
    expect(source).toContain("readArtistStudioPreference(userId)");
    expect(source).toContain("initialStudioId={initialStudioId}");
  });
});
