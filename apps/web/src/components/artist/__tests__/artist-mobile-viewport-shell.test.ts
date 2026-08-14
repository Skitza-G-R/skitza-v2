import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  fileURLToPath(new URL("../artist-app-shell.tsx", import.meta.url)),
  "utf8",
);
const mainSource = readFileSync(
  fileURLToPath(new URL("../artist-shell-main.tsx", import.meta.url)),
  "utf8",
);
const navSource = readFileSync(
  fileURLToPath(new URL("../../nav/artist-bottom-nav.tsx", import.meta.url)),
  "utf8",
);
const cancelSessionSource = readFileSync(
  fileURLToPath(new URL("../sessions/cancel-session-screen.tsx", import.meta.url)),
  "utf8",
);
const globalsCss = readFileSync(
  fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
  "utf8",
);

describe("artist mobile viewport shell", () => {
  it("uses the stable mobile viewport contract shared with the producer shell", () => {
    expect(shellSource).toContain("sk-artist-app-shell fixed inset-0 flex overflow-hidden");
    expect(shellSource).not.toContain("h-[var(--sk-viewport-height,100dvh)]");
    expect(shellSource).not.toContain("max-h-[var(--sk-viewport-height,100dvh)]");
    for (const desktopClass of ["lg:static", "lg:min-h-dvh", "lg:overflow-visible"]) {
      expect(shellSource).toContain(desktopClass);
    }
  });

  it("gives focused flows one mobile scroller instead of nesting two", () => {
    // Standing pages scroll in the shell main. Focused pages render their own
    // measured inner scroller, so the shell main must only clip that surface.
    expect(mainSource.match(/sk-native-scroll/g)).toHaveLength(1);
    expect(mainSource).toContain("overflow-hidden lg:overflow-visible");
    expect(mainSource).toContain("min-h-0");
    expect(mainSource).toContain("flex-1");
    expect(mainSource).toContain("lg:overflow-visible");
  });

  it("mounts standing-page elasticity with refresh gated to Artist Home", () => {
    expect(mainSource).toContain('<HomePullToRefresh homePath="/artist" enabled={!focused} />');
  });

  it("suppresses the native colored boundary affordance on every native page scroller", () => {
    expect(globalsCss).toMatch(
      /\.sk-native-scroll\s*\{[\s\S]*?overscroll-behavior-y:\s*none;[\s\S]*?\}/,
    );
  });

  it("anchors focused screens during ordinary overscroll while preserving keyboard offsets", () => {
    expect(globalsCss).toMatch(
      /body:not\(\[data-sk-keyboard="open"\]\)[\s\S]*main#main-content\[data-artist-shell-mode="focused"\][\s\S]*\.sk-native-screen[\s\S]*top:\s*0/,
    );
    expect(cancelSessionSource).toContain("top-[var(--sk-viewport-offset-top,0px)]");
  });

  it("does not mutate the standing scroll range while a touch gesture is active", () => {
    expect(globalsCss).not.toContain("--sk-viewport-growth");
    expect(globalsCss).not.toMatch(
      /main#main-content\[data-artist-shell-mode="standing"\][\s\S]*var\(--sk-viewport-growth/,
    );
  });

  it("keeps the live artist menu in the non-scrolling shell footer", () => {
    expect(navSource).toContain('position="in-flow"');
    expect(navSource).not.toContain('position="fixed"');

    const mainAt = shellSource.indexOf("<ArtistShellMain>");
    const mainCloseAt = shellSource.indexOf("</TopBarBreadcrumbProvider>", mainAt);
    const navAt = shellSource.indexOf("<ArtistBottomNav", mainCloseAt);
    const columnCloseAt = shellSource.indexOf("</div>", navAt);

    expect(mainAt).toBeGreaterThan(-1);
    expect(mainCloseAt).toBeGreaterThan(mainAt);
    expect(navAt).toBeGreaterThan(mainCloseAt);
    expect(columnCloseAt).toBeGreaterThan(navAt);
  });

  it("keeps the focused cancellation flow inside the measured viewport", () => {
    expect(cancelSessionSource).toContain("sk-native-screen");
    expect(cancelSessionSource).toContain("top-[var(--sk-viewport-offset-top,0px)]");
    expect(cancelSessionSource).toContain("sk-native-scroll");
    expect(cancelSessionSource).not.toContain("fixed inset-0");
    expect(cancelSessionSource).not.toContain("min-h-[calc(100dvh-57px)]");
  });
});
