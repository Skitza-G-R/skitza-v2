import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const MENU = readFileSync(join(here, "..", "project-actions-menu.tsx"), "utf8");
const CONTROLS = readFileSync(join(here, "..", "project-action-controls.tsx"), "utf8");
const ROOT_LIST = readFileSync(
  join(here, "..", "..", "clients-projects", "producer-projects-list.tsx"),
  "utf8",
);
const CLIENT_ROW = readFileSync(
  join(here, "..", "..", "clients", "client-space-project-row.tsx"),
  "utf8",
);

describe("ProjectActionsMenu shared contract", () => {
  it("matches the compact client popover treatment", () => {
    expect(MENU).toContain("w-[min(210px,calc(100vw-2rem))]");
    expect(MENU).toContain("rounded-[var(--radius-md)]");
    expect(MENU).toContain("overflow-hidden");
    expect(MENU).toContain('appearance="menu"');
    expect(CONTROLS).toMatch(/menu \? "flex w-full flex-col items-stretch"/);
    expect(CONTROLS).toContain("flex min-h-11 w-full items-center gap-2 px-3 text-left");
  });

  it("dismisses on outside pointer, outside focus, and Escape", () => {
    expect(MENU).toContain('document.addEventListener("pointerdown"');
    expect(MENU).toContain('document.addEventListener("focusin"');
    expect(MENU).toContain('document.addEventListener("keydown"');
    expect(MENU).toContain('event.key !== "Escape"');
    expect(MENU).not.toContain('addEventListener("mousedown"');
  });

  it("is shared by the root Projects list and Client Space project rows", () => {
    expect(ROOT_LIST).toContain("<ProjectActionsMenu");
    expect(ROOT_LIST).not.toContain("<ProjectActionsDisclosure");
    expect(CLIENT_ROW).toContain("<ProjectActionsMenu");
    expect(CLIENT_ROW).not.toContain("<details");
  });
});
