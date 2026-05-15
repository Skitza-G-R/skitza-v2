import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep style tests (no jsdom) for the Phase 4 ChangeStageMenu —
// the small dropdown that lets the producer advance a track's workflow
// stage without uploading. No Radix DropdownMenu (not installed in the
// repo); we implement a tight click-outside + Escape menu.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "change-stage-menu.tsx"), "utf-8");

describe("ChangeStageMenu — manual stage advance on Song Space", () => {
  it("exports a ChangeStageMenu component (function)", () => {
    expect(SRC).toMatch(/export function ChangeStageMenu/);
  });

  it("is a client component (owns local open state + Server Action calls)", () => {
    expect(SRC).toMatch(/^["']use client["']/);
  });

  it("declares the ChangeStageMenuProps shape with trackId + current", () => {
    expect(SRC).toMatch(/trackId:\s*string/);
    expect(SRC).toMatch(/current:\s*WorkflowStage/);
  });

  it("renders all 5 workflow stages via WORKFLOW_STAGES (so the list stays in sync)", () => {
    expect(SRC).toContain("WORKFLOW_STAGES");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
    // No hand-rolled enum array — we walk WORKFLOW_STAGES.map.
    expect(SRC).toMatch(/WORKFLOW_STAGES\.map/);
  });

  it("calls setTrackStageAction Server Action (not direct tRPC client)", () => {
    expect(SRC).toMatch(/setTrackStageAction/);
    expect(SRC).not.toMatch(/useMutation/);
  });

  it("imports setTrackStageAction from the clients-projects upload-actions module", () => {
    expect(SRC).toMatch(
      /~\/app\/\(producer\)\/dashboard\/clients-projects\/upload-actions/,
    );
  });

  it("uses useTransition for the mutation (pending state)", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("uses useToast for success + error feedback", () => {
    expect(SRC).toMatch(/useToast/);
    // The success toast wraps a template literal that itself contains
    // `)` (stageLabel(next)) — match by anchoring on the kind suffix.
    expect(SRC).toMatch(/,\s*["']success["']\s*\)/);
    expect(SRC).toMatch(/,\s*["']error["']\s*\)/);
  });

  it("calls router.refresh after a successful stage change", () => {
    expect(SRC).toMatch(/router\.refresh/);
  });

  it("does optimistic UI: flips the pill before the Server Action returns", () => {
    expect(SRC).toMatch(/optimistic/);
    expect(SRC).toMatch(/setOptimistic/);
  });

  it("uses a click-outside-to-close menu (no Radix DropdownMenu dep)", () => {
    // No Radix dropdown-menu IMPORT — we own the menu via a document
    // mousedown listener. Source-comment mentions are fine (the comment
    // explains the absence); we only check that no `from "...dropdown-menu"`
    // import line exists.
    expect(SRC).not.toMatch(/from\s+["']@radix-ui\/react-dropdown-menu["']/);
    expect(SRC).toMatch(/addEventListener\(["']mousedown["']/);
  });

  it("closes on Escape via a keydown listener", () => {
    expect(SRC).toMatch(/addEventListener\(["']keydown["']/);
    expect(SRC).toMatch(/Escape/);
  });

  it("renders the trigger as a button with aria-haspopup=menu", () => {
    expect(SRC).toMatch(/aria-haspopup=["']menu["']/);
    expect(SRC).toMatch(/aria-expanded=\{open\}/);
  });

  it("renders the menu list with role=menu and items with role=menuitem", () => {
    expect(SRC).toMatch(/role=["']menu["']/);
    expect(SRC).toMatch(/role=["']menuitem["']/);
  });

  it("uses lucide-react ChevronDown + Check icons for trigger + active marker", () => {
    expect(SRC).toContain("ChevronDown");
    expect(SRC).toContain("Check");
    expect(SRC).toContain('from "lucide-react"');
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
