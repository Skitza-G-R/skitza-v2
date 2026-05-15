import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "workspace-list-view.tsx"),
  "utf-8",
);

describe("WorkspaceListView source — composition + tabs + filters + drag", () => {
  it("exports a WorkspaceListView component (function)", () => {
    expect(SRC).toMatch(/export function WorkspaceListView/);
  });

  it("imports ProjectRow + ClientCard for composing the list", () => {
    expect(SRC).toContain("ProjectRow");
    expect(SRC).toContain("ClientCard");
    expect(SRC).toContain("~/components/dashboard/projects/project-row");
    expect(SRC).toContain("~/components/dashboard/clients/client-card");
  });

  it("imports StatTile for the KPI strip", () => {
    expect(SRC).toContain("StatTile");
    expect(SRC).toContain("~/components/dashboard/common/stat-tile");
  });

  it("renders all four KPI labels: Earnings / Outstanding / Needs attention / Next deadline", () => {
    expect(SRC).toContain("Earnings");
    expect(SRC).toContain("Outstanding");
    expect(SRC).toContain("Needs attention");
    expect(SRC).toContain("Next deadline");
  });

  it("supports the Projects / Clients tab segmented control", () => {
    expect(SRC).toContain("Projects");
    expect(SRC).toContain("Clients");
  });

  it("declares all six sort options: custom / recent / deadline / balance / progress / name", () => {
    expect(SRC).toContain('"custom"');
    expect(SRC).toContain('"recent"');
    expect(SRC).toContain('"deadline"');
    expect(SRC).toContain('"balance"');
    expect(SRC).toContain('"progress"');
    expect(SRC).toContain('"name"');
  });

  it("renders the project filter chips: all / urgent / active / done", () => {
    expect(SRC).toContain('"urgent"');
    expect(SRC).toContain('"active"');
    expect(SRC).toContain('"done"');
  });

  it("renders the client filter chips: all / active / balance", () => {
    expect(SRC).toContain('"balance"');
  });

  it("supports drag-and-drop handlers via native HTML5 events", () => {
    expect(SRC).toContain("onDragStart");
    expect(SRC).toContain("onDragOver");
    expect(SRC).toContain("onDrop");
  });

  it("on drop flips sort to 'custom' (URL anchor for the user's manual order)", () => {
    // The reorder UX collapses the user's last-set drag order into the
    // custom sort — the dropdown should snap back to "custom" on drop.
    expect(SRC).toMatch(/setSort\(["']custom["']\)|sort.*=.*["']custom["']/);
  });

  it("supports both card and table layouts (layout switcher)", () => {
    expect(SRC).toMatch(/layout/);
    expect(SRC).toMatch(/cards|table/);
  });

  it("uses bg-elevated for the KPI / filter container backgrounds", () => {
    expect(SRC).toContain("--bg-elevated");
  });

  it("uses border-subtle", () => {
    expect(SRC).toContain("--border-subtle");
  });

  it("uses brand-primary for the active tab / chip styling", () => {
    expect(SRC).toContain("--brand-primary");
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

  it("declares WorkspaceListViewProps with projects + clients + kpis + optional callbacks", () => {
    expect(SRC).toContain("WorkspaceListViewProps");
    expect(SRC).toContain("projects");
    expect(SRC).toContain("clients");
    expect(SRC).toContain("kpis");
  });

  it("renders the Custom sort label so users see what 'custom' means", () => {
    expect(SRC).toMatch(/Custom/);
  });

  // ── Task 12: InviteToAppModal wiring ────────────────────────────
  it("imports InviteToAppModal from the clients folder", () => {
    expect(SRC).toContain("InviteToAppModal");
    expect(SRC).toContain("~/components/dashboard/clients/invite-modal");
  });

  it("declares producerSlug as a required prop on WorkspaceListViewProps", () => {
    expect(SRC).toMatch(/producerSlug:\s*string/);
  });

  it("manages invite modal open state via local useState", () => {
    expect(SRC).toMatch(/inviteTarget|inviteOpen|inviteFor/);
    expect(SRC).toMatch(/setInviteTarget|setInviteOpen|setInviteFor/);
  });

  it("passes the producer's gradient into the modal via producerGradient", () => {
    expect(SRC).toContain("producerGradient");
  });

  it("mounts <InviteToAppModal> with producerSlug + client preview shape", () => {
    expect(SRC).toMatch(/<InviteToAppModal/);
    expect(SRC).toMatch(/producerSlug=\{producerSlug\}/);
  });

  it("labels the danger-tone project filter 'Needs attention' (matches DESIGN.md §4.1 + KPI tile)", () => {
    expect(SRC).toMatch(/value:\s*["']urgent["'],\s*label:\s*["']Needs attention["']/);
    expect(SRC).not.toMatch(/label:\s*["']Urgent["']/);
  });

  it("defaults to the Clients tab", () => {
    expect(SRC).toMatch(/useState<Tab>\(["']clients["']\)/);
  });

  it("renders the Clients tab button before the Projects tab button", () => {
    const clientsIdx = SRC.indexOf(">Clients<");
    const projectsIdx = SRC.indexOf(">Projects<");
    expect(clientsIdx).toBeGreaterThan(-1);
    expect(projectsIdx).toBeGreaterThan(clientsIdx);
  });

  it("only renders the layout switcher when tab is 'clients'", () => {
    expect(SRC).toMatch(/\{tab\s*===\s*["']clients["'][\s\S]{0,600}aria-label=["']Layout["']/);
  });

  it("renders a header with the 'Clients & Projects' title", () => {
    expect(SRC).toContain("Clients & Projects");
  });

  it("renders a 'New client' CTA when on the Clients tab", () => {
    expect(SRC).toMatch(/tab\s*===\s*["']clients["'][\s\S]{0,500}New client/);
  });

  it("renders a 'New project' CTA when on the Projects tab", () => {
    expect(SRC).toMatch(/tab\s*===\s*["']projects["'][\s\S]{0,500}New project/);
  });

  it("links the 'New project' CTA to the existing new-project route", () => {
    expect(SRC).toMatch(/href=["']\/dashboard\/clients-projects\/new["']/);
  });

  it("links the 'New client' CTA to the new-project route with clientFirst=1", () => {
    expect(SRC).toMatch(/href=["']\/dashboard\/clients-projects\/new\?clientFirst=1["']/);
  });
});
