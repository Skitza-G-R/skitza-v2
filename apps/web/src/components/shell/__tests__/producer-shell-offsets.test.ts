import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "..");
const appShell = readFileSync(join(here, "..", "app-shell.tsx"), "utf8");

const normalFlowPages = [
  "app/(producer)/dashboard/clients-projects/page.tsx",
  "app/(producer)/dashboard/music/page.tsx",
  "app/(producer)/dashboard/store/store-screen.tsx",
  "app/(producer)/dashboard/portfolio/page.tsx",
  "app/(producer)/dashboard/settings/settings-client.tsx",
  "app/(producer)/dashboard/onboarding/onboarding-wizard.tsx",
].map((path) => ({ path, source: readFileSync(join(srcRoot, path), "utf8") }));

const calendar = readFileSync(
  join(srcRoot, "app/(producer)/dashboard/calendar/page.tsx"),
  "utf8",
);

describe("producer shell normal-flow geometry", () => {
  it("does not pull producer content under the opaque topbar", () => {
    expect(appShell).not.toContain('-mt-[40px]');
  });

  it.each(normalFlowPages)("removes the retired 40px compensation from $path", ({ source }) => {
    expect(source).not.toMatch(/className="[^"]*\bmt-10\b/);
  });

  it("locks Calendar to the viewport below the 64px producer topbar", () => {
    expect(calendar).toContain("lg:h-[calc(100dvh-64px)]");
    expect(calendar).not.toContain("100dvh-40px");
  });
});
