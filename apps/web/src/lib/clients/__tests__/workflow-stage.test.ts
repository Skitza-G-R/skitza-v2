import { describe, it, expect } from "vitest";

import {
  WORKFLOW_STAGES,
  stageColor,
  stageLabel,
  stageOrder,
  type WorkflowStage,
} from "../workflow-stage";

describe("WORKFLOW_STAGES — 5-stage Skitza workflow", () => {
  it("has exactly 5 entries (Brief → Production → Mixing → Mastering → Done)", () => {
    expect(WORKFLOW_STAGES).toHaveLength(5);
  });

  it("preserves the canonical order of keys", () => {
    expect(WORKFLOW_STAGES.map((s) => s.key)).toEqual([
      "brief",
      "production",
      "mixing",
      "mastering",
      "done",
    ]);
  });

  it("every entry has a label and a sub line", () => {
    for (const s of WORKFLOW_STAGES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.sub.length).toBeGreaterThan(0);
    }
  });

  it("the labels are the human-readable strings on the WorkflowStepper", () => {
    expect(WORKFLOW_STAGES.map((s) => s.label)).toEqual([
      "Brief & intake",
      "Production",
      "Mixing",
      "Mastering",
      "Done",
    ]);
  });
});

describe("stageLabel(stage)", () => {
  it("returns the matching label for each stage key", () => {
    expect(stageLabel("brief")).toBe("Brief & intake");
    expect(stageLabel("production")).toBe("Production");
    expect(stageLabel("mixing")).toBe("Mixing");
    expect(stageLabel("mastering")).toBe("Mastering");
    expect(stageLabel("done")).toBe("Done");
  });
});

describe("stageColor(stage) — Skitza adaptation of BUILD-NOTES §6.4", () => {
  it("brief → muted/slate (uses --fg-muted token)", () => {
    expect(stageColor("brief")).toBe("rgb(var(--fg-muted))");
  });

  it("production → fixed Skitza indigo-ish (#3F4A60)", () => {
    expect(stageColor("production")).toBe("#3F4A60");
  });

  it("mixing → amber (uses --brand-primary token)", () => {
    expect(stageColor("mixing")).toBe("rgb(var(--brand-primary))");
  });

  it("mastering → emerald (uses --fg-success token)", () => {
    expect(stageColor("mastering")).toBe("rgb(var(--fg-success))");
  });

  it("done → emerald (uses --fg-success token)", () => {
    expect(stageColor("done")).toBe("rgb(var(--fg-success))");
  });
});

describe("stageOrder(stage)", () => {
  it("returns the index in WORKFLOW_STAGES", () => {
    expect(stageOrder("brief")).toBe(0);
    expect(stageOrder("production")).toBe(1);
    expect(stageOrder("mixing")).toBe(2);
    expect(stageOrder("mastering")).toBe(3);
    expect(stageOrder("done")).toBe(4);
  });
});

describe("WorkflowStage type", () => {
  it("can hold each of the 5 stage keys (compile-time check)", () => {
    const a: WorkflowStage = "brief";
    const b: WorkflowStage = "production";
    const c: WorkflowStage = "mixing";
    const d: WorkflowStage = "mastering";
    const e: WorkflowStage = "done";
    expect([a, b, c, d, e]).toHaveLength(5);
  });
});
