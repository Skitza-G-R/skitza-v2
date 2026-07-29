import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DetailsTab } from "../details-tab";

vi.mock("~/components/dashboard/projects/project-action-controls", () => ({
  ProjectActionControls: () => <div data-testid="project-actions">Project actions</div>,
}));

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "details-tab.tsx"), "utf-8");

describe("DetailsTab", () => {
  it("renders project information as read-only values before Edit", () => {
    const html = renderToStaticMarkup(
      <DetailsTab
        project={{
          name: "First Album",
          clientName: "Maya Cohen",
          workflowStage: "mixing",
          deadline: "Aug 12",
        }}
        actionProject={{
          id: "project-1",
          title: "First Album",
          clientName: "Maya Cohen",
          lifecycleStatus: "active",
          workflowStage: "mixing",
          deadlineAtIso: "2026-08-12T00:00:00.000Z",
          canDeleteEmptyDraft: false,
        }}
        onDeleted={vi.fn()}
      />,
    );

    expect(html).toContain("<dl");
    expect(html).toContain("First Album");
    expect(html).toContain("Maya Cohen");
    expect(html).toContain("Mixing");
    expect(html).toContain("Aug 12");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<textarea");
  });

  it("keeps the existing lifecycle controls at the bottom of Details", () => {
    expect(SRC.indexOf("<ProjectActionControls")).toBeGreaterThan(SRC.indexOf("</dl>"));
    expect(SRC).toContain('id="panel-details"');
    expect(SRC).toContain('aria-labelledby="tab-details"');
  });
});
