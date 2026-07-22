import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../dialog.tsx", import.meta.url)),
  "utf8",
);

describe("Dialog primitive", () => {
  it("turns off the overlay entrance for reduced-motion users", () => {
    expect(source).toMatch(
      /DialogPrimitive\.Overlay[\s\S]*motion-reduce:animate-none/,
    );
  });

  it("keeps the mobile close target at least 44px", () => {
    expect(source).toMatch(
      /DialogPrimitive\.Close[\s\S]*inline-flex h-11 w-11 items-center justify-center/,
    );
  });
});
