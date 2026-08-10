import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { metadata } from "../page";

describe("public song page metadata", () => {
  it("is noindex, nofollow, no-cache, and does not forward its secret URL", () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("uses the real Song page in guest mode with a return-to-song login", () => {
    const source = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

    expect(source).toContain("<SongPage");
    expect(source).toContain('role="guest"');
    expect(source).toContain("redirect_url");
    expect(source).toContain("Log in");
    expect(source).not.toContain("PublicSongPlayer");
  });
});
