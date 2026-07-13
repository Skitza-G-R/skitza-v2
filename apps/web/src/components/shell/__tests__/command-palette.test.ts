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
});
