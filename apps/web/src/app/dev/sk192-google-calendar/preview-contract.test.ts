import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SK192_GOOGLE_CALENDAR_PREVIEW_STATES,
  resolveSk192GoogleCalendarPreviewState,
} from "./preview-state";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(
  new URL("./google-calendar-preview.tsx", import.meta.url),
  "utf8",
);

describe("SK-192 Google Calendar visual preview", () => {
  it("is development-only and does not fetch account or database data", () => {
    expect(pageSource).toContain("if (!isDevGalleryAvailable()) notFound();");
    expect(`${pageSource}\n${previewSource}`).not.toMatch(/\bauth\s*\(|appRouter|~\/server\/db/);
  });

  it("uses the current producer navigation sources, including the real mobile nav", () => {
    expect(previewSource).toContain("ProducerBottomNav");
    expect(previewSource).toContain("NAV_ITEMS.map");
  });

  it("exposes every approval state and safely defaults unknown requests", () => {
    expect(SK192_GOOGLE_CALENDAR_PREVIEW_STATES).toEqual([
      "not-connected",
      "connecting",
      "selection",
      "empty-selection",
      "connected",
      "disconnected",
      "reconnect",
      "switch",
      "disconnect",
    ]);
    expect(resolveSk192GoogleCalendarPreviewState("switch")).toBe("switch");
    expect(resolveSk192GoogleCalendarPreviewState("unknown")).toBe("not-connected");
  });
});
