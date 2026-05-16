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
    expect(SRC).toMatch(/initialNewProjectOpen[\s\S]{0,200}["']clients["']/);
  });

  it("renders the Clients tab button before the Projects tab button", () => {
    // Whitespace-tolerant so future `prettier --write` doesn't break the test.
    const clientsIdx = SRC.search(/>\s*Clients\s*</);
    const projectsIdx = SRC.search(/>\s*Projects\s*</);
    expect(clientsIdx).toBeGreaterThan(-1);
    expect(projectsIdx).toBeGreaterThan(clientsIdx);
  });

  it("renders the layout switcher on BOTH tabs (G18 — no tab gate)", () => {
    // Pre-G18 the layout switcher only appeared on the Clients tab.
    // G18 removes the gate so the producer can flip cards/table on
    // Projects too. Locking the new behaviour: the switcher's
    // aria-label="Layout" group must not sit inside a tab-=='clients'
    // ternary anymore.
    expect(SRC).toMatch(/aria-label=["']Layout["']/);
    // Negative: the layout switcher block must NOT be wrapped by a
    // `{tab === "clients" ? (...) : null}` ternary. We pinpoint by
    // checking that the 600 chars BEFORE `aria-label="Layout"` don't
    // contain that conditional.
    const layoutIdx = SRC.indexOf('aria-label="Layout"');
    expect(layoutIdx).toBeGreaterThan(-1);
    const window = SRC.slice(Math.max(0, layoutIdx - 600), layoutIdx);
    expect(window).not.toMatch(/tab\s*===\s*["']clients["']\s*\?\s*\(/);
  });

  it("imports ProjectsTableHeader + ClientsTableHeader + ClientCompactRow for table mode", () => {
    expect(SRC).toContain("ProjectsTableHeader");
    expect(SRC).toContain("ClientsTableHeader");
    expect(SRC).toContain("ClientCompactRow");
  });

  it("renders ProjectsTableHeader when projects tab is in table layout", () => {
    expect(SRC).toMatch(/layout\s*===\s*["']table["'][\s\S]{0,200}<ProjectsTableHeader/);
  });

  it("renders ClientsTableHeader + ClientCompactRow when clients tab is in table layout", () => {
    expect(SRC).toMatch(/<ClientsTableHeader/);
    expect(SRC).toMatch(/<ClientCompactRow/);
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

  it("Outstanding KPI carries a sub line that pluralises projects-need-a-nudge", () => {
    // The ternary splits the noun-verb pair from the trailing 'a
    // nudge' across two source literals, so we assert on the
    // fragments separately instead of trying to match the rendered
    // combined string.
    expect(SRC).toMatch(/"project[s]?\s+need[s]?"/);
    expect(SRC).toContain("a nudge");
  });

  it("Needs your attention KPI carries the 'Overdue or awaiting reply' sub", () => {
    expect(SRC).toContain("Overdue or awaiting reply");
  });

  it("Next deadline KPI surfaces the project title via nextDeadlineLabel", () => {
    expect(SRC).toMatch(/nextDeadlineLabel/);
  });

  it("renders the H1 sub-line with project / active / client counts", () => {
    // Mirrors the HTML mockup's '6 projects · 4 active · 5 clients · …' bar.
    expect(SRC).toMatch(/orderedProjects\.length/);
    expect(SRC).toMatch(/orderedClients\.length/);
    expect(SRC).toContain("active");
  });

  it("H1 sub-line surfaces a danger-tinted outstanding total when > 0", () => {
    expect(SRC).toMatch(/kpis\.outstanding\s*>\s*0/);
    expect(SRC).toMatch(/outstanding/);
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
    // Header CTA + filter chips (×2) + tab seg (×2) + layout switcher (×2)
    // = at least 7 distinct active:scale call sites in the file.
    expect(activeScaleCount).toBeGreaterThanOrEqual(7);
  });

  it("filter chips ship aria-pressed for screen readers", () => {
    expect(SRC).toMatch(/aria-pressed=\{active\}/);
  });
});

describe("WorkspaceListView — round-3 toolbar match (icons + 4 client filters + list header)", () => {
  it("tab seg buttons have lucide icons (Users + FolderKanban) before the label", () => {
    // The HTML mockup carries an icon inside each pill. Adding the
    // icons immediately tightens the at-a-glance read of the tab.
    expect(SRC).toMatch(/import\s+\{[\s\S]{0,200}Users[\s\S]{0,200}\}\s+from\s+["']lucide-react["']/);
    expect(SRC).toMatch(/import\s+\{[\s\S]{0,200}FolderKanban[\s\S]{0,200}\}\s+from\s+["']lucide-react["']/);
    expect(SRC).toMatch(/<Users\s+size=\{12\}/);
    expect(SRC).toMatch(/<FolderKanban\s+size=\{12\}/);
  });

  it("Clients filter chips match the Projects tab vocabulary (All / Needs attention / Active / Done)", () => {
    // Mockup-match: same 4 filters across both tabs. 'balance' is
    // gone — superseded by 'needs-attention' (which surfaces
    // outstanding balances on the project rows beneath the client).
    expect(SRC).toMatch(/value:\s*["']needs-attention["'],\s*label:\s*["']Needs attention["']/);
    expect(SRC).toMatch(/value:\s*["']done["'],\s*label:\s*["']Done["']/);
    expect(SRC).not.toMatch(/value:\s*["']balance["'],\s*label:\s*["']Balance["']/);
  });

  it("Clients 'Needs attention' chip carries the pulsing red dot like the Projects tab", () => {
    // Source-grep that the pulse-glow keyframe is wired in BOTH
    // filter-chip render branches. Easiest way: count occurrences.
    const pulses = (SRC.match(/skitza-pulse-glow_2s_ease-in-out_infinite/g) ?? []).length;
    expect(pulses).toBeGreaterThanOrEqual(2);
  });

  it("list-header eyebrow ('Clients · N' / 'Projects · N') renders above the rows", () => {
    expect(SRC).toMatch(/data-testid="workspace-list-header"/);
    expect(SRC).toMatch(/Projects\s+·\s+\$\{String\(filteredProjects\.length\)\}/);
    expect(SRC).toMatch(/Clients\s+·\s+\$\{String\(filteredClients\.length\)\}/);
  });

  it("toolbar is a single flex row with the tab seg + chips + (right cluster)", () => {
    // After the round-3 polish the tab seg + filter chips + layout
    // switcher + sort dropdown all live in the SAME flex row (the
    // HTML mockup composes them inline). Source-grep for the
    // single-row container's classNames.
    expect(SRC).toMatch(/flex flex-wrap items-center gap-2\.5/);
    expect(SRC).toMatch(/ml-auto flex items-center gap-2/);
  });

  it("Clients filter predicates branch on 'needs-attention' AND 'done'", () => {
    expect(SRC).toMatch(/clientFilter === ["']needs-attention["']/);
    expect(SRC).toMatch(/c\.projects === 0/);
  });
});
