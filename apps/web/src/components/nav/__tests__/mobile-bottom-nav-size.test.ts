import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const PRODUCER_NAV = readFileSync(join(here, "..", "producer-bottom-nav.tsx"), "utf8");
const ARTIST_NAV = readFileSync(join(here, "..", "artist-bottom-nav.tsx"), "utf8");
const SHARED_NAV = readFileSync(join(here, "..", "liquid-glass-bottom-nav.tsx"), "utf8");
const ARTIST_SHELL = readFileSync(join(here, "..", "..", "artist", "artist-app-shell.tsx"), "utf8");
const ARTIST_SHELL_MAIN = readFileSync(
  join(here, "..", "..", "artist", "artist-shell-main.tsx"),
  "utf8",
);
const GLOBALS = readFileSync(join(here, "..", "..", "..", "app", "globals.css"), "utf8");
const SETTINGS = readFileSync(
  join(here, "..", "..", "..", "app", "(producer)", "dashboard", "settings", "settings.css"),
  "utf8",
);

describe("SK-117 mobile bottom-navigation sizing", () => {
  it("preserves the larger shared icon, label, and tap-target sizes", () => {
    expect(SHARED_NAV).toContain("gap-1");
    expect(SHARED_NAV).toContain("py-2.5");
    expect(SHARED_NAV).toContain("minHeight: 68");
    expect(SHARED_NAV).toContain("size={24}");
    expect(SHARED_NAV).toContain("fontSize: 11");
  });

  it("keeps both bars mobile-only and above the iPhone Home Indicator", () => {
    expect(SHARED_NAV).toContain("lg:hidden");
    expect(SHARED_NAV).toContain(
      '"0 max(12px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))"',
    );
    expect(PRODUCER_NAV).toContain('position="in-flow"');
    expect(ARTIST_NAV).toContain('position="fixed"');
    expect(GLOBALS).toContain("padding-bottom: 0;");
    expect(GLOBALS).not.toContain("calc(env(safe-area-inset-bottom, 0px) - 8px)");
  });

  it("keeps each 68px tab row inside a true 68px bordered surface", () => {
    const glassBlock = GLOBALS.match(/\.liquid-glass-bottom-nav__glass \{([\s\S]*?)\n\s{2}\}/)?.[1];
    const borderOverlayBlock = GLOBALS.match(
      /\.liquid-glass-bottom-nav__glass::after \{([\s\S]*?)\n\s{2}\}/,
    )?.[1];

    expect(glassBlock).toContain("height: 68px;");
    expect(glassBlock).toContain("min-height: 68px;");
    expect(glassBlock).toContain("border: 0;");
    expect(borderOverlayBlock).toContain("border: 1px solid rgb(var(--fg-onsidebar) / 0.14);");
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__magnifier-grid\s*\{[\s\S]*?height:\s*68px;/,
    );
    expect(GLOBALS).toContain(
      "grid-template-columns: repeat(var(--sk-nav-column-count), minmax(0, 1fr));",
    );
    expect(GLOBALS).toContain("--sk-nav-lens-width: calc(var(--sk-nav-column-width) - 2px);");
    expect(SHARED_NAV.match(/minHeight:\s*68/g)).toHaveLength(2);
  });

  it("reserves the larger artist nav and player stack without changing desktop spacing", () => {
    expect(ARTIST_SHELL).toContain("<ArtistShellMain>");
    expect(ARTIST_SHELL_MAIN).toContain("pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))]");
    expect(ARTIST_SHELL_MAIN).toContain("lg:pb-12");
    expect(GLOBALS).toContain("bottom: calc(80px + env(safe-area-inset-bottom, 0px));");
    expect(GLOBALS).toContain("padding-bottom: calc(182px + env(safe-area-inset-bottom));");
  });

  it("keeps the producer settings save bar above the larger mobile nav", () => {
    expect(SETTINGS).toContain("bottom: calc(84px + env(safe-area-inset-bottom, 0px));");
  });
});
