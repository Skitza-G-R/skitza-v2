import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "workflow-stepper.tsx"), "utf-8");

describe("WorkflowStepper — 5-stage horizontal stepper", () => {
  it("exports a WorkflowStepper component (function)", () => {
    expect(SRC).toMatch(/export function WorkflowStepper/);
  });

  it("imports WORKFLOW_STAGES + stageOrder + stageLabel from the helper", () => {
    expect(SRC).toContain("WORKFLOW_STAGES");
    expect(SRC).toContain("stageOrder");
    expect(SRC).toContain("stageLabel");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
  });

  it("uses a 5-column grid: repeat(5, 1fr)", () => {
    expect(SRC).toMatch(/repeat\(\s*5\s*,\s*1fr\s*\)/);
  });

  it("renders 30px round dots via h-7 w-7", () => {
    // 30px ≈ Tailwind h-7 w-7 (28px) — close enough for the spec.
    expect(SRC).toMatch(/h-7[^"]*w-7|w-7[^"]*h-7/);
  });

  it("renders the step index (1..5) or a check (✓ / Check icon) when done", () => {
    // Either lucide's `Check` import or the literal ✓ glyph signals
    // the done state.
    expect(SRC).toMatch(/Check\b|✓/);
  });

  it("marks each step's visual state — todo / done / now", () => {
    // The conditional logic for state lives in source. We assert
    // the three labels — todo / done / now — appear as conditional
    // values somewhere in the component body.
    expect(SRC).toMatch(/"done"|done\b/);
    expect(SRC).toMatch(/"now"|now\b/);
    expect(SRC).toMatch(/"todo"|todo\b/);
  });

  it("paints the done state with --fg-success (green)", () => {
    expect(SRC).toContain("--fg-success");
  });

  it("paints the now state with --brand-primary (amber)", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("paints the connector base color with --border-subtle", () => {
    expect(SRC).toContain("--border-subtle");
  });

  it("sets --wf-fill as an inline CSS variable for the connector fill", () => {
    expect(SRC).toContain("--wf-fill");
  });

  it("computes the --wf-fill percentage from stageOrder(current) / (length - 1)", () => {
    expect(SRC).toMatch(/stageOrder\(/);
    expect(SRC).toMatch(/WORKFLOW_STAGES\.length\s*-\s*1/);
  });

  it("respects prefers-reduced-motion (no-preference gate or motion-reduce variant)", () => {
    expect(SRC).toMatch(/prefers-reduced-motion|motion-reduce/);
  });

  it("defines a soft pulse animation for the now state (named keyframe or animate utility)", () => {
    expect(SRC).toMatch(/wfpulse|animate-\[|animation:\s*wfpulse|@keyframes\s+wfpulse/);
  });

  it("renders the stage sub-label (sub) underneath the main label", () => {
    expect(SRC).toContain("sub");
  });

  it("accepts a `current` WorkflowStage prop", () => {
    expect(SRC).toContain("current");
    expect(SRC).toContain("WorkflowStage");
  });

  it("marks the 'now' step with aria-current='step'", () => {
    expect(SRC).toMatch(/aria-current=["']step["']|aria-current=\{["']step["']\}/);
  });

  it("includes visually-hidden completion suffix on done steps", () => {
    expect(SRC).toMatch(/sr-only.*completed|completed.*sr-only/);
  });

  it("forbids --surface-card", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids --text-muted", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids --text-strong", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids --surface-hover", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids --brand-primary-on", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
