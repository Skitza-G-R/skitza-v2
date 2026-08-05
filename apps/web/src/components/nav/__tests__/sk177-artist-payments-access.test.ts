import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(join(here, ...segments), "utf8");

const desktopSidebar = read("..", "artist-desktop-sidebar.tsx");
const userButton = read("..", "artist-user-button.tsx");
const accountRoleMenu = read("..", "account-role-menu-items.tsx");
const bottomNav = read("..", "artist-bottom-nav.tsx");
const artistLayout = read("..", "..", "..", "app", "(artist)", "artist", "layout.tsx");
const paymentsPage = read("..", "..", "..", "app", "(artist)", "artist", "payments", "page.tsx");
const artistLoading = read("..", "..", "..", "app", "(artist)", "artist", "loading.tsx");
const artistError = read("..", "..", "..", "app", "(artist)", "artist", "error.tsx");

describe("SK-177 Artist Payments access", () => {
  it("threads the active studio through both standard Artist navigation surfaces", () => {
    for (const chrome of [desktopSidebar, bottomNav]) {
      expect(chrome).toContain('href: "/artist/payments"');
      expect(chrome).toContain("withArtistStudio");
    }
    expect(userButton).not.toContain("paymentsHref");
    expect(accountRoleMenu).not.toContain('label="Payments"');
  });

  it("uses the approved five-destination order on mobile and desktop", () => {
    for (const source of [bottomNav, desktopSidebar]) {
      const labels = ["Home", "Music", "Sessions", "Payments", "Store"];
      const positions = labels.map((label) => source.indexOf(`label: "${label}"`));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
    expect(bottomNav.match(/\{\s*href:\s*"\/artist[^"]*"/g)).toHaveLength(5);
    expect(desktopSidebar.match(/\{\s*id:\s*"[^"]+"/g)).toHaveLength(5);
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
