import { describe, it, expect } from "vitest";

import {
  STAGES,
  droppableIdForStage,
  formatRelativeTime,
  stageFromDroppableId,
} from "./kanban-helpers";

describe("stageFromDroppableId", () => {
  it("parses a valid stage droppable id", () => {
    expect(stageFromDroppableId("stage:lead")).toBe("lead");
    expect(stageFromDroppableId("stage:in_production")).toBe("in_production");
    expect(stageFromDroppableId("stage:archived")).toBe("archived");
  });

  it("returns null for unknown stage keys", () => {
    expect(stageFromDroppableId("stage:nope")).toBeNull();
    expect(stageFromDroppableId("stage:")).toBeNull();
  });

  it("returns null for ids without the stage: prefix", () => {
    expect(stageFromDroppableId("deal:123")).toBeNull();
    expect(stageFromDroppableId("lead")).toBeNull();
  });

  it("returns null for non-string inputs", () => {
    expect(stageFromDroppableId(null)).toBeNull();
    expect(stageFromDroppableId(undefined)).toBeNull();
    expect(stageFromDroppableId(42)).toBeNull();
  });

  it("round-trips through droppableIdForStage", () => {
    for (const s of STAGES) {
      expect(stageFromDroppableId(droppableIdForStage(s))).toBe(s);
    }
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-04-17T12:00:00Z");

  it("renders 'just now' for timestamps under a minute", () => {
    expect(formatRelativeTime(new Date("2026-04-17T11:59:30Z"), now)).toBe("just now");
  });

  it("renders minutes for sub-hour deltas", () => {
    expect(formatRelativeTime(new Date("2026-04-17T11:55:00Z"), now)).toBe("5m");
  });

  it("renders hours for sub-day deltas", () => {
    expect(formatRelativeTime(new Date("2026-04-17T09:00:00Z"), now)).toBe("3h");
  });

  it("renders days for sub-week deltas", () => {
    expect(formatRelativeTime(new Date("2026-04-15T12:00:00Z"), now)).toBe("2d");
  });

  it("falls back to absolute date for older timestamps", () => {
    // 12 days earlier → Apr 5
    const out = formatRelativeTime(new Date("2026-04-05T12:00:00Z"), now);
    expect(out).toMatch(/^Apr\s?\d+$/);
  });

  it("clamps future timestamps to 'just now'", () => {
    expect(formatRelativeTime(new Date("2026-04-17T12:05:00Z"), now)).toBe("just now");
  });
});
