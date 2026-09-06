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

  it("mounts standing-page elasticity with refresh on every artist main screen", () => {
    expect(mainSource).toContain('<PullToRefresh shell="artist" enabled={!focused} />');
  });

  it("suppresses the native colored boundary affordance on every native page scroller", () => {
    expect(globalsCss).toMatch(
      /\.sk-native-scroll\s*\{[\s\S]*?overscroll-behavior-y:\s*none;[\s\S]*?\}/,
    );
  });

  it("anchors focused screens during ordinary overscroll while preserving keyboard offsets", () => {
    // Focused Artist flows render their screens with `.sk-native-screen`, so
    // the anchor now covers them through that class instead of a shell-scoped
    // selector. Scoping it to the Artist shell left every other full-screen
    // surface — the producer active-work import editor among them — sliding
    // with the finger during an ordinary rubber-band overscroll.
    expect(globalsCss).toMatch(
      /body:not\(\[data-sk-keyboard="open"\]\)\s+\.sk-native-screen\s*\{\s*top:\s*0;\s*\}/,
    );
    expect(cancelSessionSource).toContain("sk-native-screen");
    expect(cancelSessionSource).toContain("top-[var(--sk-viewport-offset-top,0px)]");
  });

  it("does not mutate the standing scroll range while a touch gesture is active", () => {
    expect(globalsCss).not.toContain("--sk-viewport-growth");
    expect(globalsCss).not.toMatch(
      /main#main-content\[data-artist-shell-mode="standing"\][\s\S]*var\(--sk-viewport-growth/,
    );
  });

  // SK-306: the bar overlays the scroller instead of sitting below it, so page
  // content passes under the glass. It stays absolute inside the shell column
  // (never `fixed` to the document viewport), which is what keeps iOS
  // rubber-band from carrying it away.
  it("overlays the live artist menu on the scroller without leaving the shell", () => {
    expect(navSource).toContain('position="overlay"');
    expect(navSource).not.toContain('position="fixed"');
    expect(shellSource).toContain('<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">');
    expect(mainSource).toContain("sk-bottom-nav-inset");
    expect(globalsCss).toMatch(
      /\.sk-bottom-nav-inset\s*\{[\s\S]*?padding-bottom:\s*calc\(\s*var\(--sk-bottom-nav-inset, 0px\) \+ var\(--sk-dock-inset, 0px\)\s*\);/,
    );

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
