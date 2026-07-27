import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "client-actions-menu.tsx"), "utf8");

describe("ClientActionsMenu responsive interaction contract", () => {
  it("uses the shared portaled bottom Sheet below the desktop breakpoint", () => {
    expect(SRC).toContain('const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"');
    expect(SRC).toContain("open={open && !isDesktop}");
    expect(SRC).toMatch(/<SheetContent[\s\S]*?side="bottom"/);
    expect(SRC).toContain('data-testid="client-actions-sheet"');
    expect(SRC).toContain("<SheetTitle");
    expect(SRC).toContain("<SheetDescription");
    expect(SRC).toContain("onCloseAutoFocus");
    expect(SRC).toContain("triggerRef.current?.focus()");
  });

  it("keeps the anchored desktop disclosure and dismisses it safely", () => {
    expect(SRC).toContain("open && isDesktop");
    expect(SRC).toContain('data-testid="client-actions-popover"');
    expect(SRC).toContain('role="dialog"');
    expect(SRC).toContain('aria-modal="false"');
    expect(SRC).toContain('document.addEventListener("pointerdown"');
    expect(SRC).toContain('event.key !== "Escape"');
    expect(SRC).not.toContain('addEventListener("mousedown"');
    expect(SRC).not.toContain("onBlurCapture");
  });

  it("wires every labelled action through choose without shrinking touch targets", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => \{\s*choose\(onEdit\)/);
    expect(SRC).toMatch(/onClick=\{\(\) => \{\s*choose\(onArchive\)/);
    expect(SRC).toMatch(/onClick=\{\(\) => \{\s*choose\(onDelete\)/);
    expect(SRC).toMatch(
      /onActionStart\?\.\(triggerRef\.current\)[\s\S]*?triggerRef\.current\.focus\(\)[\s\S]*?action\?\.\(\)/,
    );
    expect(SRC).toContain("Edit details");
    expect(SRC).toContain('archived ? "Restore client" : "Archive client"');
    expect(SRC).toContain("Delete empty draft");
    expect(SRC).toMatch(/min-h-11\s+min-w-11/);
    expect(SRC).toMatch(/lg:min-h-9\s+lg:min-w-9/);
    expect(SRC).not.toMatch(/md:min-h-9\s+md:min-w-9/);
    expect(SRC).toMatch(/flex min-h-11 w-full/g);
  });
});
