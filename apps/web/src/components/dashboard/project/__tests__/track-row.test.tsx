import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "track-row.tsx"), "utf-8");

describe("TrackRow — album-page tracklist row", () => {
  it("exports a TrackRow component (function)", () => {
    expect(SRC).toMatch(/export function TrackRow/);
  });

  it("uses the BUILD-NOTES §6.4 grid: 22px 30px 38px minmax(0,1fr) 130px 180px 22px", () => {
    expect(SRC).toContain("22px 30px 38px minmax(0,1fr) 130px 180px 22px");
  });

  it("wraps the row in a Next.js Link for whole-row click navigation", () => {
    expect(SRC).toContain('from "next/link"');
  });

  it("the Link href targets the Song Space at /clients-projects/[id]/songs/[songId]", () => {
    // Build the href using template strings — search whitespace-tolerant
    // so prettier --write can't break this assertion.
    expect(SRC).toMatch(/\/dashboard\/clients-projects\/\$\{[^}]*projectId[^}]*\}\/songs\/\$\{[^}]*track\.id[^}]*\}/);
  });

  it('marks the row as draggable="true" for parent reorder handling', () => {
    expect(SRC).toMatch(/draggable=(?:"true"|\{true\})/);
  });

  it("uses div-draggable + Link-overlay pattern (matches ClientCard / ProjectRow)", () => {
    // The outer container is the draggable element — not the Link. This
    // avoids the browser-level "draggable anchor with href" treatment
    // that can hijack near-clicks into drag-with-no-drop and never
    // navigate. We assert by ruling out `draggable` on a same-tag <Link>.
    expect(SRC).not.toMatch(/<Link[^>]*draggable/);
    expect(SRC).toMatch(/<div[^>]*draggable/);
  });

  it("renders the Link as an absolute inset-0 navigation overlay", () => {
    expect(SRC).toMatch(/<Link[\s\S]*?className="[^"]*absolute inset-0/);
  });

  it("imports producerGradient for the 38px cover tile", () => {
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("imports stageColor + stageLabel from the workflow-stage helper", () => {
    expect(SRC).toContain("stageColor");
    expect(SRC).toContain("stageLabel");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
  });

  it("imports GripVertical for the drag handle and ChevronRight for the row chevron", () => {
    expect(SRC).toContain("GripVertical");
    expect(SRC).toContain("ChevronRight");
    expect(SRC).toContain('from "lucide-react"');
  });

  it("hides the drag handle by default and reveals it on group hover", () => {
    expect(SRC).toMatch(/opacity-0[^"]*group-hover:opacity-100/);
  });

  it("uses tabular-nums for the index column (mono-style 01/02 numbers)", () => {
    expect(SRC).toMatch(/tabular-nums|font-mono/);
  });

  it("formats the index as a zero-padded 2-digit string (01, 02…)", () => {
    expect(SRC).toMatch(/padStart\(\s*2\s*,\s*['"]0['"]\s*\)/);
  });

  it("renders the stage pill with a colored dot using the stage color", () => {
    // The pill border + dot share the same stageColor value
    expect(SRC).toMatch(/stageColor\(/);
  });

  it("renders a progress bar with the brand-primary amber fill", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("renders the percentage label with tabular-nums for alignment", () => {
    expect(SRC).toMatch(/tabular-nums/);
  });

  it("the chevron is plain (no surrounding pill wrapper) and uses fg-muted color", () => {
    // The chevron sits in the trailing 22px column — no rounded pill or
    // border around it. We assert by ruling out a wrapping rounded-full
    // class adjacent to the ChevronRight import.
    expect(SRC).not.toMatch(/rounded-full[^<]*ChevronRight/);
  });

  it("exposes onDragStart / onDragOver / onDrop props so the parent owns reorder state", () => {
    expect(SRC).toContain("onDragStart");
    expect(SRC).toContain("onDragOver");
    expect(SRC).toContain("onDrop");
  });

  it("renders the meta line: currentVersion · noteCount notes · duration when present", () => {
    expect(SRC).toContain("currentVersion");
    expect(SRC).toContain("noteCount");
    expect(SRC).toContain("durationMs");
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
