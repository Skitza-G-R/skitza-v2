import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const BOTTOM = readFileSync(join(here, "..", "artist-bottom-nav.tsx"), "utf8");
const SIDEBAR = readFileSync(join(here, "..", "artist-desktop-sidebar.tsx"), "utf8");
const MOBILE_TOPBAR = readFileSync(join(here, "..", "artist-mobile-top-bar.tsx"), "utf8");

describe("artist Payments navigation", () => {
  it("replaces Settings with Payments in the mobile main navigation", () => {
    expect(BOTTOM).toMatch(
      /href:\s*["']\/artist\/payments["'],\s*label:\s*["']Payments["'],\s*icon:\s*["']payments["']/,
    );
    expect(BOTTOM).not.toMatch(/href:\s*["']\/artist\/settings["'],\s*label:\s*["']Settings["']/);
  });

  it("replaces Settings with Payments in the desktop main navigation", () => {
    expect(SIDEBAR).toMatch(
      /id:\s*["']payments["'],\s*href:\s*["']\/artist\/payments["'],\s*label:\s*["']Payments["']/,
    );
    expect(SIDEBAR).not.toMatch(/id:\s*["']settings["'],\s*href:\s*["']\/artist\/settings["']/);
  });

  it("keeps Settings in both artist account controls", () => {
    for (const source of [SIDEBAR, MOBILE_TOPBAR]) {
      expect(source).toContain("<UserButton.MenuItems>");
      expect(source).toContain("<UserButton.Link");
      expect(source).toContain('label="Settings"');
      expect(source).toContain('href="/artist/settings"');
    }
  });
});
