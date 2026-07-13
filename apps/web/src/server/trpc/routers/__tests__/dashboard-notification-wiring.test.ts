import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const artistRouter = readFileSync(join(here, "..", "artist.ts"), "utf8");

describe("producer notification wiring", () => {
  it("emits a real producer event after an artist comment is saved", () => {
    expect(artistRouter).toContain("emitCommentCreated");
    expect(artistRouter).toMatch(
      /await emitCommentCreated\(ctx\.db,[\s\S]*?commentId: row\.id[\s\S]*?projectId: project\.id/,
    );
    expect(artistRouter).toContain("[notify] comment-created failed");
  });
});
