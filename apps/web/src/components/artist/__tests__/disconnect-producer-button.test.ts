import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "disconnect-producer-button.tsx"), "utf8");

describe("DisconnectProducerButton", () => {
  it("names the destructive target, uses the danger token, and keeps a 44px target", () => {
    expect(source).toMatch(/aria-label=\{`Disconnect from \$\{producerName\}`\}/);
    expect(source).toContain("min-h-11");
    expect(source).toContain("rgb(var(--fg-danger))");
    expect(source).not.toContain("var(--danger)");
  });

  it("requires explicit confirmation before invoking the server action", () => {
    const confirmationIndex = source.indexOf("window.confirm(message)");
    const actionIndex = source.indexOf("disconnectProducerAction({ producerId })");

    expect(confirmationIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(confirmationIndex);
  });
});
