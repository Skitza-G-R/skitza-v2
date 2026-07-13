import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const nextConfigSource = readFileSync(
  fileURLToPath(new URL("../../next.config.ts", import.meta.url)),
  "utf8",
);

describe("Next server runtime packaging", () => {
  it("keeps ws external so its optional bufferutil fallback works on Vercel", () => {
    expect(nextConfigSource).toMatch(
      /serverExternalPackages\s*:\s*\[[^\]]*["']ws["'][^\]]*\]/s,
    );
    expect(nextConfigSource).toMatch(/WS_NO_BUFFER_UTIL\s*:\s*["']1["']/);
  });
});
