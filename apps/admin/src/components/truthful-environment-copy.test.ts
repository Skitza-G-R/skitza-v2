import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// SK-278. The console used to tell the founder "simulations on · external
// actions off" on every page, including the Beta page that sends real Producer
// invitations to real people. Someone trusting that line could release a wave
// to 200 addresses believing it was a rehearsal. These assertions keep the
// claim from creeping back into shared chrome, and keep the access copy from
// naming a wall that only exists in one ADMIN_ACCESS_MODE.

const SRC = join(import.meta.dirname, "..");

function source(relativePath: string): string {
  return readFileSync(join(SRC, relativePath), "utf8");
}

/**
 * Source with comments removed, so the assertions below judge what a founder
 * can actually read on screen. The comments in these files deliberately quote
 * the retired wording to explain why it went away.
 */
function renderedSource(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CHROME_FILES = [
  "components/admin-shell.tsx",
  "components/environment-choice.tsx",
] as const;

describe("admin chrome never claims external actions are disabled", () => {
  it.each(CHROME_FILES)("%s makes no blanket simulation claim", (file) => {
    const rendered = renderedSource(file).toLowerCase();

    expect(rendered).not.toContain("external actions off");
    expect(rendered).not.toContain("simulations on");
    expect(rendered).not.toContain("disconnected actions");
  });

  it("keeps the Live/Test environment label, which is the true part", () => {
    expect(source("components/admin-shell.tsx")).toContain("environment");
  });
});

describe("access copy stays vendor-neutral", () => {
  it("does not name Cloudflare Access, which is absent in vercel-protection mode", () => {
    expect(renderedSource("app/unlock/page.tsx")).not.toContain("Cloudflare Access");
  });
});
