import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ACTIONS_SRC = readFileSync(join(here, "..", "producer-mobile-actions.tsx"), "utf-8");
const TOPBAR_SRC = readFileSync(join(here, "..", "dashboard-topbar.tsx"), "utf-8");
const SHELL_SRC = readFileSync(join(here, "..", "app-shell.tsx"), "utf-8");

describe("producer mobile account + public-link controls", () => {
  it("threads the producer slug from the shell into the mobile controls", () => {
    expect(SHELL_SRC).toMatch(/producerSlug=\{slug\}/);
    expect(TOPBAR_SRC).toContain("ProducerMobileActions");
    expect(TOPBAR_SRC).toMatch(/producerSlug=\{producerSlug\}/);
  });

  it("mounts Clerk's account menu in mobile-only dashboard chrome", () => {
    expect(ACTIONS_SRC).toContain("UserButton");
    expect(ACTIONS_SRC).toContain("UserAvatar");
    expect(ACTIONS_SRC).toContain('data-testid="topbar-account"');
    expect(ACTIONS_SRC).toContain("lg:hidden");
    expect(ACTIONS_SRC).toContain('aria-label="Open account menu"');
  });

  it("opens the Clerk account menu in the same mobile bottom-sheet pattern as notifications", () => {
    expect(ACTIONS_SRC).toContain("Sheet");
    expect(ACTIONS_SRC).toContain('side="bottom"');
    expect(ACTIONS_SRC).toContain("__experimental_asProvider");
    expect(ACTIONS_SRC).toContain("UserButton.__experimental_Outlet");
    expect(ACTIONS_SRC).toContain('data-testid="account-sheet"');
  });

  it("keeps Store and Settings reachable from the mobile account sheet", () => {
    expect(ACTIONS_SRC).toContain('data-testid="producer-mobile-profile-links"');
    expect(ACTIONS_SRC).toContain('href="/dashboard/store"');
    expect(ACTIONS_SRC).toContain('href="/dashboard/settings"');
    expect(ACTIONS_SRC).toContain('aria-label="Producer account links"');
    expect(ACTIONS_SRC.match(/prefetch=\{false\}/g)).toHaveLength(2);
    expect(
      ACTIONS_SRC.match(/announceRuntimeMainNavigationIntent/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(ACTIONS_SRC.match(/data-sk-nav-destination=/g)).toHaveLength(2);
    expect(
      ACTIONS_SRC.match(/captureRuntimeMainNavigationTarget/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("keeps the accepted target mounted until the exact href actually commits", () => {
    expect(ACTIONS_SRC).toContain("const pathname = usePathname()");
    expect(ACTIONS_SRC).toContain("const searchParams = useSearchParams()");
    expect(ACTIONS_SRC).toContain(
      'const currentHref = `${pathname}${search ? `?${search}` : ""}`',
    );
    expect(ACTIONS_SRC).toMatch(
      /useEffect\(\(\) => \{\s*setAccountOpen\(false\);\s*\}, \[currentHref\]\)/,
    );
    expect(ACTIONS_SRC).not.toMatch(
      /onClick=\{\(event\) => \{\s*captureRuntimeMainNavigationTarget\(event\.currentTarget\);[\s\S]{0,80}setAccountOpen\(false\)/,
    );
    expect(ACTIONS_SRC).not.toMatch(
      /if \(pathname === "\/dashboard\/(?:store|settings)"\) setAccountOpen\(false\)/,
    );
    expect(ACTIONS_SRC).toContain(
      'if (currentHref === "/dashboard/store") setAccountOpen(false)',
    );
    expect(ACTIONS_SRC).toContain(
      'if (currentHref === "/dashboard/settings") setAccountOpen(false)',
    );
  });

  it("provides a 40px mobile copy target using the existing clipboard behavior", () => {
    expect(ACTIONS_SRC).toContain("copyPublicLink");
    expect(ACTIONS_SRC).toContain("buildJoinUrl");
    expect(ACTIONS_SRC).toContain('aria-label="Copy public link"');
    expect(ACTIONS_SRC).toContain("h-10 w-10");
  });

  it("keeps the mobile actions out of desktop layout", () => {
    expect(ACTIONS_SRC).toMatch(/data-testid="producer-mobile-actions"[\s\S]{0,160}lg:hidden/);
  });

  it("uses no forbidden Skitza CSS tokens", () => {
    expect(ACTIONS_SRC).not.toContain("--surface-card");
    expect(ACTIONS_SRC).not.toContain("--surface-hover");
    expect(ACTIONS_SRC).not.toContain("--text-muted");
    expect(ACTIONS_SRC).not.toContain("--text-strong");
  });
});
