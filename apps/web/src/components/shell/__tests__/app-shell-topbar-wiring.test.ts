import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins that AppShell mounts the DashboardTopBar immediately before the
// mobile scroll surface. The two remain inside one breadcrumb provider,
// but the topbar must not be a child of the elastic iOS scroller.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "app-shell.tsx"), "utf-8");

describe("AppShell + DashboardTopBar wiring", () => {
  it("imports DashboardTopBar from ./dashboard-topbar", () => {
    expect(SRC).toMatch(
      /import\s+\{[\s\S]*?DashboardTopBar[\s\S]*?\}\s+from\s+["']\.\/dashboard-topbar["']/,
    );
  });

  it("renders <DashboardTopBar> before and outside the mobile scroll surface", () => {
    const mainIdx = SRC.indexOf("<main");
    const topbarIdx = SRC.indexOf("<DashboardTopBar");
    const childrenIdx = SRC.indexOf("{children}");
    expect(mainIdx).toBeGreaterThan(-1);
    expect(topbarIdx).toBeGreaterThan(-1);
    expect(topbarIdx).toBeLessThan(mainIdx);
    expect(childrenIdx).toBeGreaterThan(mainIdx);
  });

  it("keeps the topbar and routed page inside one breadcrumb provider", () => {
    const providerOpenIdx = SRC.indexOf("<TopBarBreadcrumbProvider>");
    const topbarIdx = SRC.indexOf("<DashboardTopBar");
    const mainIdx = SRC.indexOf("<main");
    const providerCloseIdx = SRC.indexOf("</TopBarBreadcrumbProvider>");

    expect(providerOpenIdx).toBeGreaterThan(-1);
    expect(topbarIdx).toBeGreaterThan(providerOpenIdx);
    expect(mainIdx).toBeGreaterThan(topbarIdx);
    expect(providerCloseIdx).toBeGreaterThan(mainIdx);
  });

  it("keeps main-content as the only custom elastic mobile scroll surface", () => {
    expect(SRC).toMatch(
      /<main[\s\S]{0,180}id="main-content"[\s\S]{0,220}overflow-y-auto[\s\S]{0,100}overscroll-y-none/,
    );
  });

  it("mounts shell elasticity with refresh on every producer main screen", () => {
    expect(SRC).toContain('<PullToRefresh shell="producer" />');
  });

  it("threads unreadCount into the topbar (matches the bell dot guard)", () => {
    expect(SRC).toMatch(/<DashboardTopBar[\s\S]{0,80}unreadCount=\{unreadCount\}/);
  });

  it("threads recent active notifications into the topbar centre", () => {
    expect(SRC).toMatch(/<DashboardTopBar[\s\S]{0,160}recentNotifications=\{recentNotifications\}/);
  });

  it("does not duplicate notification state into ProducerSidebar", () => {
    const sidebarStart = SRC.indexOf("<ProducerSidebar");
    const sidebarEnd = SRC.indexOf("/>", sidebarStart);
    const sidebarOpening = SRC.slice(sidebarStart, sidebarEnd);
    expect(sidebarOpening).not.toContain("unreadCount");
    expect(sidebarOpening).not.toContain("recentNotifications");
  });
});
