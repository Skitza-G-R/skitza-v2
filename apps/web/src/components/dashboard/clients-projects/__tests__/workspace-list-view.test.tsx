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
    // Whitespace-tolerant so future `prettier --write` doesn't break the test.
    const clientsIdx = SRC.search(/>\s*Clients\s*</);
    const projectsIdx = SRC.search(/>\s*Projects\s*</);
    expect(clientsIdx).toBeGreaterThan(-1);
    expect(projectsIdx).toBeGreaterThan(clientsIdx);
  });

  it("only renders the layout switcher when tab is 'clients'", () => {
    expect(SRC).toMatch(/\{tab\s*===\s*["']clients["'][\s\S]{0,600}aria-label=["']Layout["']/);
  });

  it("renders a header with the 'Clients & Projects' title", () => {
    // Sibling convention in apps/web/src/components/dashboard uses the
    // &amp; HTML entity (see project-room-hero.tsx, overview-screen.tsx,
    // overview-sub-tab.tsx). Match that.
    expect(SRC).toContain("Clients &amp; Projects");
  });

  // The "+ New client" CTA was previously a <Link> to
  // /dashboard/clients-projects/new?clientFirst=1. Phase 1 G6 swapped it
  // for a <button> that opens NewClientModal. The "New project" CTA on
  // the Projects tab stays as a <Link>.
  it("renders a 'New client' CTA as a <button> on the Clients tab (opens modal)", () => {
    expect(SRC).toMatch(/tab\s*===\s*["']clients["'][\s\S]{0,500}New client/);
    // CTA itself is now a <button> with onClick instead of a <Link>.
    expect(SRC).toMatch(
      /tab\s*===\s*["']clients["'][\s\S]{0,500}<button[\s\S]{0,500}New client/,
    );
  });

  it("does NOT link the 'New client' CTA to /new?clientFirst=1 (route flow was replaced by the modal)", () => {
    expect(SRC).not.toMatch(/clientFirst=1/);
  });

  it("renders a 'New project' CTA when on the Projects tab", () => {
    expect(SRC).toMatch(/tab\s*===\s*["']projects["'][\s\S]{0,500}New project/);
  });

  // Phase 1 G7 — the "+ New project" CTA was a <Link href="/dashboard/
  // clients-projects/new"> before. It now opens NewProjectModal in the
  // same flow as "+ New client" did in G6. The href should be gone.
  it("does NOT route the 'New project' CTA to /clients-projects/new", () => {
    expect(SRC).not.toMatch(/href=["']\/dashboard\/clients-projects\/new["']/);
  });

  it("renders the 'New project' CTA as a <button> on the Projects tab (opens modal)", () => {
    expect(SRC).toMatch(
      /tab\s*===\s*["']projects["'][\s\S]{0,500}<button[\s\S]{0,500}New project/,
    );
  });

  // ── G6: NewClientModal wiring ───────────────────────────────────
  it("imports NewClientModal from the clients folder", () => {
    expect(SRC).toContain("NewClientModal");
    expect(SRC).toContain("~/components/dashboard/clients/new-client-modal");
  });

  it("manages NewClientModal open state via local useState (setNewClientOpen)", () => {
    expect(SRC).toContain("setNewClientOpen");
    expect(SRC).toContain("newClientOpen");
  });

  it("mounts <NewClientModal> with open + onClose + onCreated handlers", () => {
    expect(SRC).toMatch(/<NewClientModal/);
    expect(SRC).toMatch(/open=\{newClientOpen\}/);
    expect(SRC).toMatch(/onClose=\{/);
    expect(SRC).toMatch(/onCreated=\{/);
  });

  it("wires the 'New client' CTA onClick to open the modal", () => {
    expect(SRC).toMatch(/onClick=\{\(\)\s*=>\s*\{\s*setNewClientOpen\(true\)/);
  });

  // ── G7: NewProjectModal wiring ──────────────────────────────────
  it("imports NewProjectModal from the clients folder", () => {
    expect(SRC).toContain("NewProjectModal");
    expect(SRC).toContain("~/components/dashboard/clients/new-project-modal");
  });

  it("manages NewProjectModal open state via local useState (setNewProjectOpen)", () => {
    expect(SRC).toContain("setNewProjectOpen");
    expect(SRC).toContain("newProjectOpen");
  });

  it("mounts <NewProjectModal> with open + onClose + clients + products", () => {
    expect(SRC).toMatch(/<NewProjectModal/);
    expect(SRC).toMatch(/open=\{newProjectOpen\}/);
    expect(SRC).toMatch(/onClose=\{/);
    expect(SRC).toMatch(/clients=\{/);
    expect(SRC).toMatch(/products=\{/);
  });

  it("wires the 'New project' CTA onClick to open the modal", () => {
    expect(SRC).toMatch(/onClick=\{\(\)\s*=>\s*\{\s*setNewProjectOpen\(true\)/);
  });

  it("declares products as a required prop on WorkspaceListViewProps", () => {
    expect(SRC).toMatch(/products:\s*/);
  });
});
