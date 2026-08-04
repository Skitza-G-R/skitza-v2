import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(join(here, ...segments), "utf8");

const desktopSidebar = read("..", "artist-desktop-sidebar.tsx");
const mobileTopBar = read("..", "artist-mobile-top-bar.tsx");
const userButton = read("..", "artist-user-button.tsx");
const bottomNav = read("..", "artist-bottom-nav.tsx");
const artistLayout = read("..", "..", "..", "app", "(artist)", "artist", "layout.tsx");
const paymentsPage = read("..", "..", "..", "app", "(artist)", "artist", "payments", "page.tsx");
const artistLoading = read("..", "..", "..", "app", "(artist)", "artist", "loading.tsx");
const artistError = read("..", "..", "..", "app", "(artist)", "artist", "error.tsx");

describe("SK-177 Artist Payments access", () => {
  it("threads the active studio through both artist account menu entry points", () => {
    for (const chrome of [desktopSidebar, mobileTopBar]) {
      expect(chrome).toContain(
        'paymentsHref={withArtistStudio("/artist/payments", activeStudioId)}',
      );
    }
    expect(userButton).toContain("paymentsHref");
  });

  it("keeps the approved four standing mobile tabs unchanged", () => {
    expect(bottomNav.match(/\{\s*href:\s*"\/artist[^"]*"/g)).toHaveLength(4);
    expect(bottomNav).not.toMatch(/label:\s*["']Payments["']/);
  });

  it("preserves Artist authorization and every existing Payments state surface", () => {
    expect(artistLayout).toContain('requireRole("artist")');
    expect(paymentsPage).toContain('redirect("/sign-in")');
    expect(paymentsPage).toContain("createCaller({ userId }).artist.purchase.payments()");
    expect(paymentsPage).toContain("model.artistBuckets.waiting");
    expect(paymentsPage).toContain("model.artistBuckets.active");
    expect(paymentsPage).toContain("model.artistBuckets.history");
    expect(paymentsPage).toContain("Nothing is waiting");
    expect(paymentsPage).toContain("No active balances");
    expect(paymentsPage).toContain("No payment history yet");
    expect(artistLoading).toContain("animate-pulse motion-reduce:animate-none");
    expect(artistError).toContain('role="alert"');
    expect(artistError).toContain("Try again");
  });
});
