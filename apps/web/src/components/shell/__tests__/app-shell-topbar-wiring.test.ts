import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins that AppShell mounts the DashboardTopBar at the top of <main>.
// If a future refactor moves the topbar (or accidentally removes it),
// this test catches the regression before navigation visibly breaks
// for the producer.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "app-shell.tsx"), "utf-8");

describe("AppShell + DashboardTopBar wiring", () => {
  it("imports DashboardTopBar from ./dashboard-topbar", () => {
    expect(SRC).toMatch(
      /import\s+\{[\s\S]*?DashboardTopBar[\s\S]*?\}\s+from\s+["']\.\/dashboard-topbar["']/,
    );
  });

  it("renders <DashboardTopBar> inside <main>", () => {
    // Crude but effective: the topbar JSX must appear after <main> in
    // the source and before {children}. We don't try to parse JSX —
    // a source-level positional check is enough to catch the most
    // common regression (forgetting to render the new chrome).
    const mainIdx = SRC.indexOf("<main");
    const topbarIdx = SRC.indexOf("<DashboardTopBar");
    const childrenIdx = SRC.indexOf("{children}");
    expect(mainIdx).toBeGreaterThan(-1);
    expect(topbarIdx).toBeGreaterThan(mainIdx);
    expect(childrenIdx).toBeGreaterThan(topbarIdx);
  });

  it("threads unreadCount into the topbar (matches the bell dot guard)", () => {
    expect(SRC).toMatch(/<DashboardTopBar[\s\S]{0,80}unreadCount=\{unreadCount\}/);
  });
});
