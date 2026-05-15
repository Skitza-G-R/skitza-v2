import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "overview-tab.tsx"), "utf-8");

describe("overview-tab — WorkflowStepper + Latest versions + Client snippet", () => {
  it("exports an OverviewTab component (function)", () => {
    expect(SRC).toMatch(/export function OverviewTab/);
  });

  it("imports WorkflowStepper for the workflow card", () => {
    expect(SRC).toContain("WorkflowStepper");
    expect(SRC).toContain("~/components/dashboard/song/workflow-stepper");
  });

  it("imports VersionRow for the Latest versions list", () => {
    expect(SRC).toContain("VersionRow");
    expect(SRC).toContain("~/components/dashboard/song/version-row");
  });

  it("imports LinkPill for the Client snippet (album mode)", () => {
    expect(SRC).toContain("LinkPill");
    expect(SRC).toContain("~/components/dashboard/clients/link-pill");
  });

  it("renders a 'Workflow' heading above the stepper", () => {
    expect(SRC).toMatch(/Workflow/);
  });

  it("renders a 'Latest versions' heading", () => {
    expect(SRC).toMatch(/Latest\s*versions/);
  });

  it("renders a 'See all →' button that triggers onShowAllVersions", () => {
    expect(SRC).toMatch(/See\s*all/);
    expect(SRC).toContain("onShowAllVersions");
  });

  it("hides the Client snippet in single mode (mode === 'single' guard)", () => {
    // The client card is rendered ONLY when mode !== 'single'. We
    // assert the conditional render check appears in source.
    expect(SRC).toMatch(/mode\s*!==\s*["']single["']|mode\s*===\s*["']album["']/);
  });

  it("renders the client name + email in the client snippet (album mode)", () => {
    expect(SRC).toContain("client.name");
    expect(SRC).toContain("client.email");
  });

  it("uses a 2-column grid for the lower half (lg:grid-cols-2)", () => {
    expect(SRC).toMatch(/lg:grid-cols-2/);
  });

  it("sets role=tabpanel on the wrapping section", () => {
    expect(SRC).toContain('role="tabpanel"');
  });

  it("imports producerGradient / producerInitials for the client avatar", () => {
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("producerInitials");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("renders only the top-3 latest versions in the card", () => {
    // Either `.slice(0, 3)` for the array or a hard `slice(0,3)` form.
    expect(SRC).toMatch(/slice\(\s*0\s*,\s*3\s*\)/);
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
