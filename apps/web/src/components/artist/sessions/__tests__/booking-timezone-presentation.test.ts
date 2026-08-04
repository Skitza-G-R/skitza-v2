import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, ...parts), "utf8");

const detailSource = read("..", "session-detail-screen.tsx");
const confirmationSource = read("..", "confirmation-hero.tsx");
const pastStudioSource = read(
  "..",
  "..",
  "..",
  "..",
  "app",
  "(artist)",
  "artist",
  "settings",
  "studios",
  "[producerId]",
  "sessions",
  "[sessionId]",
  "page.tsx",
);

describe("producer-authored booking timezone presentation", () => {
  it("uses producer time for live and historical Artist session details", () => {
    expect(detailSource).not.toMatch(/session\.artistTimezone/);
    expect(detailSource).toMatch(/session\.producerTimezone/);
    expect(detailSource).toMatch(/formatSessionTimeZoneLabel/);

    expect(pastStudioSource).not.toMatch(/session\.artistTimezone/);
    expect(pastStudioSource).toMatch(/session\.producerTimezone/);
    expect(pastStudioSource).toMatch(/formatSessionTimeZoneLabel/);
  });

  it("shows the date-correct producer timezone on booking confirmation", () => {
    expect(confirmationSource).toMatch(/formatSessionTimeZoneLabel/);
    expect(confirmationSource).toMatch(/session\.producerTimezone/);
  });
});
