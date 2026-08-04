import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../first-version-upload.ts", import.meta.url), "utf8");

describe("first-Version upload stage wiring", () => {
  it("maps only the typed presigner failure to the safe presign marker", () => {
    expect(source).toContain("FirstVersionUploadPresignError");
    expect(source).toMatch(
      /error instanceof FirstVersionUploadPresignError[\s\S]*?code: "PRECONDITION_FAILED"[\s\S]*?message: error\.message/,
    );
  });
});
