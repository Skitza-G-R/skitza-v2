import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/server/trpc/routers/audio-delivery.ts"),
  "utf8",
);

describe("SK-144 audio-delivery batch router wiring", () => {
  it("exposes one bounded, exact producer batch read", () => {
    expect(source).toContain("overrideStates: producerProcedure.input(OverrideBatchScope)");
    expect(source).toContain("producerDownloadStateRepository(ctx.db)");
    expect(source).toContain("producerId: ctx.producerId");
    expect(source).toContain("actorClerkUserId: ctx.userId");
    expect(source).toContain("purchaseId: input.purchaseId");
    expect(source).toContain("trackId: input.trackId");
    expect(source).toContain("versionIds: input.versionIds");
    expect(source).toContain("new Set(versionIds).size === versionIds.length");
    expect(source).not.toMatch(/versionIds:[\s\S]{0,160}\.max\(/);
  });
});
