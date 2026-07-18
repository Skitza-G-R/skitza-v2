import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const settingsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageSource = readFileSync(join(settingsDir, "page.tsx"), "utf8");
const actionSource = readFileSync(join(settingsDir, "actions.ts"), "utf8");
const clientSource = readFileSync(join(settingsDir, "settings-client.tsx"), "utf8");

describe("producer payment instructions settings", () => {
  it("loads and saves through the focused purchase payment-instructions boundary", () => {
    expect(pageSource).toMatch(/producer\.purchase\.paymentInstructions\.get/);
    expect(actionSource).toMatch(/producer\.purchase\.paymentInstructions\.update/);
  });

  it("reports and adopts partial saves instead of presenting them as a total failure", () => {
    expect(actionSource).toMatch(/Promise\.allSettled/);
    expect(actionSource).toMatch(/paymentInstructionsSaved/);
    expect(actionSource).not.toMatch(/Promise\.all\(writes\)/);
    expect(clientSource).toMatch(/res\.saved\?\.producer/);
    expect(clientSource).toMatch(/res\.saved\?\.paymentInstructions/);
  });

  it("edits bank transfer, Bit, and an optional note", () => {
    expect(clientSource).toMatch(/Payment instructions/);
    expect(clientSource).toMatch(/Bank transfer/);
    expect(clientSource).toMatch(/Bit/);
    expect(clientSource).toMatch(/Payment note/);
    expect(clientSource).toMatch(/patch\.paymentInstructions = form\.paymentInstructions/);
    expect(clientSource).toMatch(/maxLength=\{500\}/);
    expect(clientSource).toMatch(/maxLength=\{32\}/);
  });

  it("makes Skitza's record-keeper boundary explicit", () => {
    expect(clientSource).toMatch(/Artists pay you directly/);
    expect(clientSource).toMatch(/never holds, routes/);
    expect(clientSource).toMatch(/splits,\s+refunds, or credits money/);
  });
});
