import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, ...parts), "utf8");

const detailSource = read("..", "session-detail-screen.tsx");
const confirmationSource = read("..", "confirmation-hero.tsx");
const rowSource = read("..", "session-row.tsx");

describe("Artist-primary booking timezone presentation", () => {
  it("uses Artist time first across the live session surfaces", () => {
    for (const source of [detailSource, confirmationSource, rowSource]) {
      expect(source).toMatch(/session\.artistTimezone/);
    }
    expect(detailSource).toMatch(/session\.producerTimezone/);
    expect(detailSource).toMatch(/formatStudioTimeLine/);
    expect(confirmationSource).not.toMatch(/formatStudioTimeLine/);
    expect(rowSource).not.toMatch(/formatStudioTimeLine/);
    expect(detailSource).toMatch(/formatSessionTimeZoneLabel/);
  });

  it("shows the date-correct Artist timezone on booking confirmation", () => {
    expect(confirmationSource).toMatch(/formatSessionTimeZoneLabel/);
    expect(confirmationSource).toMatch(/session\.artistTimezone/);
  });
});
