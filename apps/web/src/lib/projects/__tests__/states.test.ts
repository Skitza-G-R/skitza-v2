import { describe, expect, it } from "vitest";

import { ALL_STAGES, type Stage } from "../stages";
import {
  PROJECT_STATES,
  STATE_LABEL,
  STATE_TO_STAGES,
  isProjectState,
  stageToState,
} from "../states";

// Batch G — confirm the 9 stages collapse correctly to the 3
// display states. If someone adds a new stage to the enum (an 8th
// Kanban stage, say), this matrix forces them to pick a state too;
// otherwise `stageToState` would silently lump it into "live".

describe("stageToState", () => {
  it("maps every declared stage to a project state", () => {
    // Exhaustive — if ALL_STAGES grows we want a test to break loudly
    // rather than falling through to the catch-all "live" branch.
    const matrix: Record<Stage, (typeof PROJECT_STATES)[number]> = {
      lead: "live",
      booked: "live",
      in_production: "live",
      final_review: "live",
      paid: "done",
      archived: "archived",
    };
    for (const stage of ALL_STAGES) {
      expect(stageToState(stage), `stageToState(${stage})`).toBe(matrix[stage]);
    }
  });

  it("collapses paid → done and archived → archived", () => {
    expect(stageToState("paid")).toBe("done");
    expect(stageToState("archived")).toBe("archived");
  });

  it("collapses all in-flight stages → live", () => {
    const live: Stage[] = [
      "lead",
      "booked",
      "in_production",
      "final_review",
    ];
    for (const s of live) {
      expect(stageToState(s), s).toBe("live");
    }
  });
});

describe("STATE_TO_STAGES", () => {
  it("is the inverse of stageToState", () => {
    for (const state of PROJECT_STATES) {
      for (const stage of STATE_TO_STAGES[state]) {
        expect(stageToState(stage)).toBe(state);
      }
    }
  });

  it("covers every stage exactly once", () => {
    const seen = new Set<Stage>();
    for (const state of PROJECT_STATES) {
      for (const stage of STATE_TO_STAGES[state]) {
        expect(seen.has(stage), `${stage} seen twice`).toBe(false);
        seen.add(stage);
      }
    }
    expect(seen.size).toBe(ALL_STAGES.length);
  });
});

describe("STATE_LABEL", () => {
  it("has a label for every state", () => {
    for (const state of PROJECT_STATES) {
      expect(STATE_LABEL[state]).toBeDefined();
      expect(STATE_LABEL[state].length).toBeGreaterThan(0);
    }
  });

  it("uses human-readable capitalized labels", () => {
    expect(STATE_LABEL.live).toBe("Live");
    expect(STATE_LABEL.done).toBe("Done");
    expect(STATE_LABEL.archived).toBe("Archived");
  });
});

describe("isProjectState", () => {
  it("accepts known states", () => {
    expect(isProjectState("live")).toBe(true);
    expect(isProjectState("done")).toBe(true);
    expect(isProjectState("archived")).toBe(true);
  });

  it("rejects unknown strings, numbers, null, undefined", () => {
    expect(isProjectState("lead")).toBe(false);
    expect(isProjectState("paid")).toBe(false);
    expect(isProjectState("")).toBe(false);
    expect(isProjectState(42)).toBe(false);
    expect(isProjectState(null)).toBe(false);
    expect(isProjectState(undefined)).toBe(false);
  });
});
