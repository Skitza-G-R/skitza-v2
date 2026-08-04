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

  it("compensates a presigner failure only for the exact newly inserted producer intent", () => {
    const prepare = source.slice(source.indexOf("  prepare:"), source.indexOf("\n\n  complete:"));

    expect(prepare).toMatch(
      /presignFirstVersionUploadWithCompensation\(\{[\s\S]*?newlyInserted:\s*Boolean\(inserted\)[\s\S]*?ctx\.db[\s\S]*?\.delete\(firstVersionUploadIntents\)[\s\S]*?eq\(firstVersionUploadIntents\.id, intent\.id\)[\s\S]*?eq\(firstVersionUploadIntents\.producerId, ctx\.producerId\)[\s\S]*?isNull\(firstVersionUploadIntents\.completedAt\)[\s\S]*?isNull\(firstVersionUploadIntents\.canceledAt\)/,
    );
  });
});
