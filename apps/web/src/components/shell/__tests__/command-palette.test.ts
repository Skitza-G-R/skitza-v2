import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "command-palette.tsx"), "utf8");

describe("CommandPalette accessibility", () => {
  it("gives the Radix dialog an explicit accessible title", () => {
    expect(source).toContain('import * as Dialog from "@radix-ui/react-dialog"');
    expect(source).toContain('<Dialog.Title className="sr-only">Command palette</Dialog.Title>');
  });

  it("uses only current producer destinations", () => {
    expect(source).toContain("/dashboard/store");
    expect(source).toContain("/dashboard/clients-projects?newProject=1");
    expect(source).not.toContain("/dashboard/profile");
    expect(source).not.toContain("/dashboard/clients-projects/new");
  });

  it("opens a selected client instead of dropping the user on the generic list", () => {
    expect(source).toContain("/dashboard/clients-projects/clients/${c.id}");
  });

  it("does not advertise the removed Contracts search category", () => {
    expect(source.toLowerCase()).not.toContain("contracts");
  });
});
