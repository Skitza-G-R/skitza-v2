import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const settingsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageSource = readFileSync(join(settingsDir, "page.tsx"), "utf8");
const actionSource = readFileSync(join(settingsDir, "actions.ts"), "utf8");
const clientSource = readFileSync(join(settingsDir, "settings-client.tsx"), "utf8");
const cssSource = readFileSync(join(settingsDir, "settings.css"), "utf8");

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

  it("presents payment setup as a focused producer task with a live artist preview", () => {
    expect(clientSource).toMatch(/How artists pay you/);
    expect(clientSource).toMatch(/Only approved artists see these details/);
    expect(clientSource).toMatch(/s-payment-workspace/);
    expect(clientSource).toMatch(/s-payment-preview/);
    expect(clientSource).toMatch(/What the artist will see/);
    expect(clientSource).toMatch(/paymentInstructions\.bankTransfer/);
    expect(clientSource).toMatch(/paymentInstructions\.bitPhone/);
    expect(clientSource).toMatch(/paymentInstructions\.note/);
  });

  it("uses a responsive editor/preview layout without introducing public exposure copy", () => {
    expect(cssSource).toMatch(/\.s-payment-workspace\s*{[^}]*grid-template-columns:/);
    expect(cssSource).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.s-payment-workspace\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(clientSource).toMatch(/Shown only after approval/);
    expect(clientSource).not.toMatch(/publicly visible/i);
  });

  it("keeps Save and Discard visible after payment details change", () => {
    expect(clientSource).toContain('className={`s-savebar${dirty ? " s-show" : ""}`}');
  });

  it("keeps the Bank and Bit setup compact on desktop and mobile", () => {
    expect(clientSource).toContain('className="s-reveal s-payment-section"');
    expect(clientSource).toMatch(/id="settings-bank-transfer"[\s\S]{0,160}rows=\{3\}/);
    expect(clientSource).toMatch(/id="settings-payment-note"[\s\S]{0,160}rows=\{2\}/);
    expect(cssSource).toMatch(/\.s-payment-method\s*{[^}]*padding:\s*14px 16px/);
    expect(cssSource).toMatch(
      /\.s-payment-method-bank \.s-textarea\s*{[^}]*min-height:\s*72px/,
    );
  });
});
