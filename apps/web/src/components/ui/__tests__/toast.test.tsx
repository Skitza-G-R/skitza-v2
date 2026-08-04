import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "toast.tsx"), "utf8");
const WEB_SRC = join(here, "..", "..", "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("Toast feedback", () => {
  it("uses the adaptive elevated surface", () => {
    expect(SRC).toMatch(/--bg-elevated/);
  });

  it("uses the normal adaptive foreground", () => {
    expect(SRC).toMatch(/--fg-default/);
  });

  it("keeps messages away from bottom navigation and actions", () => {
    expect(SRC).toMatch(/position=["']top-center["']/);
    expect(SRC).toContain("mobileOffset");
    expect(SRC).toContain("safe-area-inset-top");
    expect(SRC).toContain("visibleToasts={2}");
  });

  it("renders the action button in brand-primary for visual prominence", () => {
    expect(SRC).toMatch(/actionButton[\s\S]{0,300}--brand-primary/);
  });

  it("keeps the public useToast API (message, variant, options)", () => {
    expect(SRC).toMatch(/toast:\s*\(\s*message[\s\S]{0,300}variant[\s\S]{0,300}options/);
  });

  it("gives every toast an accessible manual close control", () => {
    expect(SRC).toMatch(/<SonnerToaster[\s\S]{0,500}?closeButton/);
    expect(SRC).toContain('closeButtonAriaLabel: "Dismiss message"');
  });

  it("uses a longer readable duration for errors", () => {
    expect(SRC).toContain("ERROR_TOAST_DURATION_MS");
    expect(SRC).toMatch(/variant === "error"[\s\S]{0,120}ERROR_TOAST_DURATION_MS/);
  });

  it("supports stable ids, lifecycle callbacks, and programmatic dismissal", () => {
    expect(SRC).toContain("id?: string | number");
    expect(SRC).toContain("onDismiss?: () => void");
    expect(SRC).toContain("onAutoClose?: () => void");
    expect(SRC).toContain("sonnerToast.dismiss(id)");
  });

  it("keeps error toasts compact and calm", () => {
    expect(SRC).toContain("!w-[min(19rem,calc(100vw-1rem))]");
    expect(SRC).not.toMatch(/error:[\s\S]{0,180}--fg-danger\)\/0\.6/);
  });

  it("mounts exactly one toast provider and one Sonner toaster in the app", () => {
    const appSource = sourceFiles(WEB_SRC)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(appSource.match(/<ToastProvider(?:\s|>)/g)).toHaveLength(1);
    expect(appSource.match(/<SonnerToaster(?:\s|>)/g)).toHaveLength(1);
  });
});
