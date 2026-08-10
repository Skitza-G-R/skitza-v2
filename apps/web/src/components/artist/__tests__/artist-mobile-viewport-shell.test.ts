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

describe("artist mobile viewport shell", () => {
  it("uses the measured visual viewport and keeps document scrolling disabled on mobile", () => {
    expect(shellSource).toContain(
      "fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] flex h-[var(--sk-viewport-height,100dvh)] max-h-[var(--sk-viewport-height,100dvh)] overflow-hidden",
    );
    for (const desktopClass of [
      "lg:static",
      "lg:h-auto",
      "lg:max-h-none",
      "lg:min-h-dvh",
      "lg:overflow-visible",
    ]) {
      expect(shellSource).toContain(desktopClass);
    }
  });

  it("makes the routed main surface the only elastic mobile scroller", () => {
    // Both standing pages and the non-overlay loading states used by focused
    // routes must remain scrollable now that the viewport shell clips document
    // scrolling. Focused screens that own a fixed native viewport are
    // unaffected by this fallback scroller.
    expect(mainSource.match(/sk-native-scroll/g)).toHaveLength(2);
    expect(mainSource).toContain("min-h-0");
    expect(mainSource).toContain("flex-1");
    expect(mainSource).toContain("lg:overflow-visible");
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
