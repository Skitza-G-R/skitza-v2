import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const producerRouter = readFileSync(join(process.cwd(), "src/server/trpc/routers/producer.ts"), "utf8");

describe("producer.music.detail performance contract", () => {
  it("starts approval and comment reads together after resolving the version stack", () => {
    const detail = producerRouter.slice(
      producerRouter.indexOf("    detail: producerProcedure"),
      producerRouter.indexOf("\n  }),", producerRouter.indexOf("    detail: producerProcedure")),
    );

    expect(detail).toMatch(
      /const \[approvalRows, comments\][\s\S]{0,180}await Promise\.all\(\[[\s\S]*versionApprovalEvents[\s\S]*trackComments/,
    );
  });
});
