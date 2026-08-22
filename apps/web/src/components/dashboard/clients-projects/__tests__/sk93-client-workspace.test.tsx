import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "workspace-list-view.tsx"), "utf8");
const clientsDir = join(here, "..", "..", "clients");
const compactRow = readFileSync(join(clientsDir, "client-compact-row.tsx"), "utf8");
const mobileRow = readFileSync(join(clientsDir, "mobile-client-row.tsx"), "utf8");
const actionsMenu = readFileSync(join(clientsDir, "client-actions-menu.tsx"), "utf8");

describe("SK-93 client workspace", () => {
  it("makes Find client obvious and searches stable client fields", () => {
    expect(source).toMatch(/type=["']search["']/);
    expect(source).toContain("Find client");
    expect(source).toMatch(/clientSearch|searchQuery|deferredClientSearch/);
  });

  it("uses clear Active and Archived client filters", () => {
    expect(source).toMatch(/value:\s*["']active["'],\s*label:\s*["']Active["']/);
    expect(source).toMatch(/value:\s*["']archived["'],\s*label:\s*["']Archived["']/);
    expect(source).toMatch(/client\.archived/);
    expect(source).toContain("activeClientCount");
    expect(source).toContain("archivedClientCount");
  });

  it("wires one Edit / Archive-or-Restore disclosure in both responsive rows", () => {
    expect(source).toMatch(/onEdit=/g);
    expect(source).toMatch(/onArchive=/g);
    expect(compactRow).toContain("<ClientActionsMenu");
    expect(mobileRow).toContain("<ClientActionsMenu");
    expect(actionsMenu).toContain("Edit details");
    expect(actionsMenu).toContain('archived ? "Restore client" : "Archive client"');
    expect(source).toContain("EditClientModal");
    expect(source).toContain("ClientArchiveConfirmModal");
    expect(source).toMatch(/blockedReason=\{archiveTarget\.archiveBlockedReason/);
  });

  it("has explicit no-client, no-archived-client, and no-search-result states", () => {
    expect(source).toContain("No active clients yet");
    expect(source).toContain("No archived clients");
    expect(source).toContain("No clients match");
  });

  it("uses the public link and active-work import instead of a manual project creator", () => {
    expect(source).toContain("Copy my Skitza link");
    expect(source).toContain("Bring in active work");
    expect(source).toContain("buildJoinUrl");
    expect(source).not.toContain("NewProjectModal");
    expect(source).not.toContain("onNewProject");
  });

  it("chooses a recent-first client order with no client layout or sort decision", () => {
    expect(source).toMatch(/isoMs\(right\.lastActivityIso\)\s*-\s*isoMs\(left\.lastActivityIso\)/);
    expect(source).not.toMatch(/aria-label=["']Layout["']/);
    expect(source).not.toMatch(/aria-label=["']Sort["']/);
  });
});
