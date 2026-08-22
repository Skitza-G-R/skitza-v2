import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(join(here, "..", "workspace-list-view.tsx"), "utf8");
const clientDir = join(here, "..", "..", "clients");
const compactRow = readFileSync(join(clientDir, "client-compact-row.tsx"), "utf8");
const mobileRow = readFileSync(join(clientDir, "mobile-client-row.tsx"), "utf8");
const actionsMenu = readFileSync(join(clientDir, "client-actions-menu.tsx"), "utf8");
const hero = readFileSync(join(clientDir, "client-space-hero.tsx"), "utf8");
const edit = readFileSync(join(clientDir, "edit-client-modal.tsx"), "utf8");
const archive = readFileSync(join(clientDir, "client-archive-confirm-modal.tsx"), "utf8");
const remove = readFileSync(join(clientDir, "remove-client-confirm-modal.tsx"), "utf8");
const money = readFileSync(join(clientDir, "client-money-ledger.tsx"), "utf8");

describe("compact client UX defaults", () => {
  it("chooses one responsive client roster and a recent-first default", () => {
    expect(workspace).not.toMatch(/<ClientCard(?:\s|\/)/);
    expect(workspace).toContain("<ClientCompactRow");
    expect(workspace).toContain("<MobileClientRow");
    expect(workspace).toMatch(
      /isoMs\(right\.lastActivityIso\)\s*-\s*isoMs\(left\.lastActivityIso\)/,
    );
  });

  it("keeps removed project layout controls and project sorting out of the Clients branch", () => {
    expect(workspace).not.toMatch(/aria-label=["']Layout["']/);
    expect(workspace).not.toMatch(/aria-label=["']Sort["']/);
    expect(workspace).toContain("<ProducerProjectsList");
  });

  it("shows client filter counts and does not restore removed project KPI strips", () => {
    expect(workspace).toContain("activeClientCount");
    expect(workspace).toContain("archivedClientCount");
    expect(workspace).not.toContain('data-testid="project-kpi-strips"');
    expect(workspace).not.toContain("StatTile");
  });

  it("uses one disclosed row action control instead of two always-visible decisions", () => {
    expect(compactRow).toContain("<ClientActionsMenu");
    expect(mobileRow).toContain("<ClientActionsMenu");
    expect(actionsMenu).toContain("Edit details");
    expect(actionsMenu).toContain('archived ? "Restore client" : "Archive client"');
    expect(workspace).toMatch(/onEdit=\{setEditTarget\}/);
    expect(workspace).toMatch(/onArchive=\{setArchiveTarget\}/);
  });

  it("raises an open row menu above neighboring row controls", () => {
    expect(compactRow).toContain("has-[[aria-expanded=true]]:z-30");
    expect(mobileRow).toContain("has-[[aria-expanded=true]]:z-30");
  });
});

describe("compact client detail decisions", () => {
  it("uses one contextual primary action and hides delete without shared-domain eligibility", () => {
    expect(hero).toContain("canPermanentlyDelete");
    expect(hero).toContain("Add email");
    expect(hero).toContain("Restore client");
    expect(hero).not.toContain("New project");
    expect(hero).not.toContain("NewProjectModal");
    expect(hero).toMatch(/canPermanentlyDelete\s*\?/);
  });

  it("keeps optional edit fields behind More details and disables a no-op save", () => {
    expect(edit).toContain("More details");
    expect(edit).toContain("hasChanges");
    expect(edit).toMatch(/const submitDisabled\s*=\s*[\s\S]{0,100}pending\s*\|\|\s*!hasChanges/);
    expect(edit).toContain("disabled={submitDisabled}");
  });

  it("puts duplicate-email feedback inline and returns focus to Email", () => {
    expect(edit).toContain("serverEmailError");
    expect(edit).toContain("emailRef");
    expect(edit).toMatch(/role=["']alert["']/);
    expect(edit).toMatch(/emailRef\.current\?\.focus\(\)/);
  });

  it("removes the dead Archive choice when the domain rule blocks it", () => {
    expect(archive).toContain("Can’t archive");
    expect(archive).toMatch(/!archiveIsBlocked\s*\?/);
    expect(archive).not.toMatch(/disabled=\{pending\s*\|\|\s*archiveIsBlocked\}/);
  });

  it("lets Radix generate matching accessible description ids for every client dialog", () => {
    for (const source of [edit, archive, remove]) {
      expect(source).toContain("<DialogPrimitive.Description");
      expect(source).not.toMatch(/<DialogPrimitive\.Description\s+id=/);
    }
  });

  it("uses a stable three-column money summary on every viewport", () => {
    expect(money).toContain("grid-cols-3");
    expect(money).not.toContain("grid-cols-5");
  });
});
