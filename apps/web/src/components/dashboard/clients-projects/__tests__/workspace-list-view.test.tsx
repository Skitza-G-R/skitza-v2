import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "workspace-list-view.tsx"), "utf-8");

describe("WorkspaceListView source — compact clients + configurable projects", () => {
  it("exports a WorkspaceListView component (function)", () => {
    expect(SRC).toMatch(/export function WorkspaceListView/);
  });

  it("uses ProjectRow plus automatic mobile and desktop client rows", () => {
    expect(SRC).toContain("ProjectRow");
    expect(SRC).toContain("ClientCardData");
    expect(SRC).toContain("MobileClientRow");
    expect(SRC).toContain("ClientCompactRow");
    expect(SRC).toContain("~/components/dashboard/projects/project-row");
    expect(SRC).not.toMatch(/<ClientCard(?:\s|\/)/);
  });

  it("imports StatTile for the project-only KPI strip", () => {
    expect(SRC).toContain("StatTile");
    expect(SRC).toContain("~/components/dashboard/common/stat-tile");
  });

  it("renders all four project KPI labels: Earnings / Outstanding / Needs attention / Next deadline", () => {
    expect(SRC).toContain("Earnings");
    expect(SRC).toContain("Outstanding");
    expect(SRC).toContain("Needs attention");
    expect(SRC).toContain("Next deadline");
    expect(SRC).toMatch(/tab\s*===\s*["']projects["']\s*\?\s*\([\s\S]{0,150}project-kpi-strips/);
  });

  it("supports the Projects / Clients tab segmented control", () => {
    expect(SRC).toContain("Projects");
    expect(SRC).toContain("Clients");
  });

  it("keeps all seven sort options for Projects", () => {
    expect(SRC).toContain('"custom"');
    expect(SRC).toContain('"recent"');
    expect(SRC).toContain('"deadline"');
    expect(SRC).toContain('"balance"');
    expect(SRC).toContain('"progress"');
    expect(SRC).toContain('"joined"');
    expect(SRC).toContain('"name"');
    expect(SRC.match(/aria-label=["']Sort["']/g)).toHaveLength(1);
  });

  it("renders the project filter chips: all / urgent / active / archived", () => {
    expect(SRC).toContain('"urgent"');
    expect(SRC).toContain('"active"');
    expect(SRC).toContain('"archived"');
  });

  it("gives empty archived lists a clear way back to active work", () => {
    expect(SRC).toContain("No archived projects");
    expect(SRC).toContain("View active projects");
    expect(SRC).toContain("No archived clients");
    expect(SRC).toContain("View active clients");
  });

  it("uses lifecycle status, not presentation tone, to separate active and archived projects", () => {
    expect(SRC).toContain('p.lifecycleStatus === "completed"');
    expect(SRC).toContain('p.lifecycleStatus === "canceled"');
  });

  it("renders only Active / Archived client filters with counts", () => {
    expect(SRC).toMatch(/value:\s*["']active["'],\s*label:\s*["']Active["']/);
    expect(SRC).toMatch(/value:\s*["']archived["'],\s*label:\s*["']Archived["']/);
    expect(SRC).toContain("activeClientCount");
    expect(SRC).toContain("archivedClientCount");
  });

  it("keeps native drag-and-drop for Projects only", () => {
    expect(SRC).toContain("handleProjectDragStart");
    expect(SRC).toContain("handleProjectDragOver");
    expect(SRC).toContain("handleProjectDrop");
    expect(SRC).not.toContain("handleClientDragStart");
    expect(SRC).not.toContain("handleClientDrop");
  });

  it("a project drop flips sort to 'custom'", () => {
    // The reorder UX collapses the user's last-set drag order into the
    // custom sort — the dropdown should snap back to "custom" on drop.
    expect(SRC).toMatch(/setSort\(["']custom["']\)|sort.*=.*["']custom["']/);
  });

  it("delegates persistence to the latest-request rollback guard", () => {
    expect(SRC).toContain('import { useToast } from "~/components/ui/toast"');
    expect(SRC).toContain("const previousProjects = orderedProjects");
    expect(SRC).toContain("persistLatestProjectOrder");
    expect(SRC).toContain("projectReorderGenerationRef");
    expect(SRC).toContain("serializeProjectOrderPersistence");
    expect(SRC).toContain("projectReorderPersistenceRef");
    expect(SRC).toContain("rollback: setOrderedProjects");
    expect(SRC).toContain('toast(message, "error")');
  });

  it("does not let an earlier revalidation invalidate the queued latest reorder", () => {
    expect(SRC).toContain("projectReorderPendingGenerationRef");
    expect(SRC).toContain("projectReorderPropSyncEpoch");
    expect(SRC).toContain("setProjectReorderPropSyncEpoch");
    expect(SRC).toContain("canSyncProjectProps");
    expect(SRC).toMatch(
      /if \(!canSyncProjectProps\(projectReorderPendingGenerationRef\.current\)\) return;/,
    );
    expect(SRC).toMatch(
      /projectReorderPendingGenerationRef\.current === generation[\s\S]{0,160}projectReorderPendingGenerationRef\.current = null/,
    );
    expect(SRC).toMatch(
      /setProjectReorderPropSyncEpoch\(\(epoch\) => epoch \+ 1\)/,
    );
    expect(SRC).toMatch(/\[projects, projectReorderPropSyncEpoch\]/);
  });

  it("supports keyboard project moves through the same persisted order path", () => {
    expect(SRC).toContain("handleProjectMove");
    expect(SRC).toContain("onReorderProjects");
    expect(SRC).toContain("onMove: handleProjectMove");
    expect(SRC).toContain("applyProjectOrder(next, previousProjects)");
  });

  it("moves keyboard reorders relative to the rows visible through a filter", () => {
    expect(SRC).toContain("moveProjectRelativeToVisibleRows");
    expect(SRC).toContain("filteredProjects.map((project) => project.id)");
  });

  it("exposes reorder controls only when a persistence callback exists", () => {
    expect(SRC).toMatch(/\.\.\.\(onReorderProjects[\s\S]{0,240}onDragStart: handleProjectDragStart/);
    expect(SRC).toMatch(/onMove: handleProjectMove[\s\S]{0,80}: \{\}\)/);
  });

  it("implements Joined as newest-created-first project sorting", () => {
    expect(SRC).toMatch(/case "joined":[\s\S]{0,160}compareProjectsByJoined/);
  });

  it("wires the Clients Joined header to newest-joined-first client sorting", () => {
    expect(SRC).toMatch(/sort\s*===\s*["']joined["'][\s\S]{0,120}compareClientsByJoined/);
    expect(SRC).toMatch(/<ClientsTableHeader\s+sort=\{sort\}\s+onSortChange=\{updateSort\}/);
  });

  it("supports both card and table layouts for Projects", () => {
    expect(SRC).toMatch(/layout/);
    expect(SRC).toMatch(/cards|table/);
    expect(SRC.match(/aria-label=["']Layout["']/g)).toHaveLength(1);
    expect(SRC).toMatch(
      /\{tab\s*===\s*["']projects["']\s*\?\s*\(\s*<div className=["']order-2 ml-auto[\s\S]*?aria-label=["']Layout["'][\s\S]*?aria-label=["']Sort["'][\s\S]*?\)\s*:\s*null\}/,
    );
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

  it("imports SORT_OPTIONS + SortValue from the shared sort-value module", () => {
    // SORT_OPTIONS (incl. the "Custom" label) was extracted to
    // ./sort-value so ProjectsTableHeader + ClientsTableHeader can
    // dispatch the same values without circular imports. The user-
    // visible "Custom" label now lives in that file.
    expect(SRC).toMatch(/import\s*\{[^}]*SORT_OPTIONS[^}]*\}\s*from\s*["']\.\/sort-value["']/);
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

  it("defaults to the Clients tab (or Projects when ?newProject=1)", () => {
    // Phase 1 G7 — the tab default is now conditional on the
    // initialNewProjectOpen prop. The default-when-not-set is still
    // "clients", but the test allows the conditional shape.
    expect(SRC).toMatch(
      /initialNewProjectOpen && !searchParams\.has\(["']tab["']\)[\s\S]{0,60}\? ["']projects["']\s*: urlState\.tab/,
    );
  });

  it("restores bounded list state from the URL without persisting client or project data", () => {
    expect(SRC).toContain("parseWorkspaceUrlState");
    expect(SRC).toContain("window.history.replaceState");
    expect(SRC).toMatch(/params\.get\("search"\)[\s\S]{0,80}\.slice\(0, 120\)/);
    expect(SRC).not.toMatch(/localStorage|sessionStorage/);
  });

  it("renders the Clients tab button before the Projects tab button", () => {
    // Whitespace-tolerant so future `prettier --write` doesn't break the test.
    const clientsIdx = SRC.search(/>\s*Clients\s*</);
    const projectsIdx = SRC.search(/>\s*Projects\s*</);
    expect(clientsIdx).toBeGreaterThan(-1);
    expect(projectsIdx).toBeGreaterThan(clientsIdx);
  });

  it("renders the layout switcher only on Projects", () => {
    expect(SRC).toMatch(/aria-label=["']Layout["']/);
    const layoutIdx = SRC.indexOf('aria-label="Layout"');
    expect(layoutIdx).toBeGreaterThan(-1);
    expect(SRC).toMatch(
      /\{tab\s*===\s*["']projects["']\s*\?\s*\(\s*<div className=["']order-2 ml-auto[\s\S]*?aria-label=["']Layout["'][\s\S]*?\)\s*:\s*null\}/,
    );
  });

  it("imports ProjectsTableHeader + ClientsTableHeader + ClientCompactRow for table mode", () => {
    expect(SRC).toContain("ProjectsTableHeader");
    expect(SRC).toContain("ClientsTableHeader");
    expect(SRC).toContain("ClientCompactRow");
  });

  it("renders ProjectsTableHeader when projects tab is in table layout", () => {
    expect(SRC).toMatch(/layout\s*===\s*["']table["'][\s\S]{0,200}<ProjectsTableHeader/);
  });

  it("renders ClientsTableHeader + ClientCompactRow as the desktop client default", () => {
    expect(SRC).toMatch(/<ClientsTableHeader/);
    expect(SRC).toMatch(/<ClientCompactRow/);
    expect(SRC).toMatch(
      /className=["']hidden rounded-\[var\(--radius-md\)\] border md:block["'][\s\S]{0,400}<ClientsTableHeader[\s\S]{0,250}role=["']list["']/,
    );
    expect(SRC).not.toMatch(/layout\s*===\s*["']table["'][\s\S]{0,100}<ClientsTableHeader/);
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
    expect(SRC).toMatch(/tab\s*===\s*["']clients["'][\s\S]{0,500}<button[\s\S]{0,500}New client/);
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
    expect(SRC).toMatch(/tab\s*===\s*["']projects["'][\s\S]{0,500}<button[\s\S]{0,500}New project/);
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

  it("mounts <NewProjectModal> with open + onClose + stable clients", () => {
    expect(SRC).toMatch(/<NewProjectModal/);
    expect(SRC).toMatch(/open=\{newProjectOpen\}/);
    expect(SRC).toMatch(/onClose=\{/);
    expect(SRC).toMatch(/clients=\{/);
    expect(SRC).not.toMatch(/products=\{/);
  });

  it("wires the 'New project' CTA onClick to open the modal", () => {
    expect(SRC).toMatch(/onClick=\{\(\)\s*=>\s*\{\s*setNewProjectOpen\(true\)/);
  });

  it("does not accept commercial product terms in WorkspaceListViewProps", () => {
    expect(SRC).not.toMatch(/products:\s*/);
  });
});

describe("WorkspaceListView — mockup-match polish (KPI subtitles, H1 sub-line, CTA shadow)", () => {
  it("KPI 'Earnings · this month' label matches the HTML mockup eyebrow", () => {
    // HTML uses 'EARNINGS · THIS MONTH' — the live label folds that
    // time-window into the label itself instead of needing a second
    // line for it.
    expect(SRC).toContain("Earnings · this month");
  });

  it("KPI 'Needs your attention' label matches the HTML mockup wording", () => {
    expect(SRC).toContain("Needs your attention");
  });

  it("commercial KPIs render the pending purchase projection as unavailable", () => {
    expect(SRC).toMatch(/earnings:\s*number\s*\|\s*null/);
    expect(SRC).toMatch(/outstanding:\s*number\s*\|\s*null/);
    expect(SRC).toContain("Commercial totals unavailable");
  });

  it("Needs your attention KPI carries the 'Overdue or awaiting reply' sub", () => {
    expect(SRC).toContain("Overdue or awaiting reply");
  });

  it("Next deadline KPI surfaces the project title via nextDeadlineLabel", () => {
    expect(SRC).toMatch(/nextDeadlineLabel/);
  });

  it("renders a contextual H1 sub-line for the selected tab", () => {
    expect(SRC).toMatch(/orderedProjects\.length/);
    expect(SRC).toContain("activeClientCount");
    expect(SRC).toContain("archivedClientCount");
    expect(SRC).toContain("active");
  });

  it("H1 sub-line surfaces unavailable commercial totals without fabricating zero", () => {
    expect(SRC).toContain("Commercial totals unavailable");
  });

  it("header CTA uses layered shadow + ease-out cubic-bezier (premium pill)", () => {
    // Pin the curve + scale press-feedback so a future "let's simplify"
    // edit doesn't quietly regress the motion.
    expect(SRC).toMatch(/cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/);
    expect(SRC).toMatch(/active:scale-\[0\.97\]/);
  });

  it("filter chips have press feedback (active:scale) + custom easing", () => {
    // The same Emil-style motion utilities are applied to every
    // interactive chip / toggle in the toolbar.
    const activeScaleCount = (SRC.match(/active:scale-\[/g) ?? []).length;
    // Header CTA + filter chips + tab seg + project layout switcher.
    expect(activeScaleCount).toBeGreaterThanOrEqual(7);
  });

  it("filter chips ship aria-pressed for screen readers", () => {
    expect(SRC).toMatch(/aria-pressed=\{active\}/);
  });

  it("keeps short filter labels at least 44px wide on phones", () => {
    const mobileFilterTargets = SRC.match(
      /min-h-\[44px\][^"]*min-w-11[^"]*sm:min-h-0[^"]*sm:min-w-0/g,
    );
    expect(mobileFilterTargets).toHaveLength(2);
  });
});

describe("WorkspaceListView — client archive filters and list header", () => {
  it("tab seg buttons have lucide icons (Users + FolderKanban) before the label", () => {
    // The HTML mockup carries an icon inside each pill. Adding the
    // icons immediately tightens the at-a-glance read of the tab.
    expect(SRC).toMatch(
      /import\s+\{[\s\S]{0,200}Users[\s\S]{0,200}\}\s+from\s+["']lucide-react["']/,
    );
    expect(SRC).toMatch(
      /import\s+\{[\s\S]{0,200}FolderKanban[\s\S]{0,200}\}\s+from\s+["']lucide-react["']/,
    );
    expect(SRC).toMatch(/<Users\s+size=\{12\}/);
    expect(SRC).toMatch(/<FolderKanban\s+size=\{12\}/);
  });

  it("Clients filter chips expose the approved Active and Archived views", () => {
    expect(SRC).toMatch(/value:\s*["']active["'],\s*label:\s*["']Active["']/);
    expect(SRC).toMatch(/value:\s*["']archived["'],\s*label:\s*["']Archived["']/);
    expect(SRC).not.toMatch(/value:\s*["']balance["'],\s*label:\s*["']Balance["']/);
  });

  it("keeps the pulsing urgency cue on the Projects Needs attention chip", () => {
    const pulses = (SRC.match(/skitza-pulse-glow_2s_ease-in-out_infinite/g) ?? []).length;
    expect(pulses).toBeGreaterThanOrEqual(1);
  });

  it("list-header eyebrow ('Clients · N' / 'Projects · N') renders above the rows", () => {
    expect(SRC).toMatch(/data-testid="workspace-list-header"/);
    expect(SRC).toMatch(/Projects\s+·\s+\$\{String\(filteredProjects\.length\)\}/);
    expect(SRC).toMatch(/Clients\s+·\s+\$\{String\(filteredClients\.length\)\}/);
  });

  it("toolbar re-flows on phones and keeps project controls in a gated right cluster", () => {
    expect(SRC).toMatch(/flex flex-wrap items-center gap-2\.5/);
    expect(SRC).toMatch(/tab\s*===\s*["']projects["']\s*\?\s*\([\s\S]{0,150}order-2 ml-auto/);
    expect(SRC).toMatch(/order-3[\s\S]{0,120}overflow-x-auto[\s\S]{0,200}md:flex-wrap/);
    expect(SRC).toMatch(
      /hidden items-center gap-0\.5 rounded-\[var\(--radius-lg\)\] border p-0\.5 md:inline-flex/,
    );
  });

  it("Clients filter predicates use the producer archive state", () => {
    expect(SRC).toMatch(/clientFilter === ["']archived["']/);
    expect(SRC).toMatch(/c\.archived\s*:\s*!c\.archived/);
  });
});
