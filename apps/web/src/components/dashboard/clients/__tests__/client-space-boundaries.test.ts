import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isArchivedClientSpaceProject } from "../client-space-project-row";

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = readFileSync(join(here, "..", "client-space-workspace.tsx"), "utf8");
const PROJECT_ROW = readFileSync(join(here, "..", "client-space-project-row.tsx"), "utf8");
const NEW_PROJECT = readFileSync(join(here, "..", "new-project-modal.tsx"), "utf8");
const INVITE = readFileSync(join(here, "..", "invite-modal.tsx"), "utf8");
const COMPOSER = readFileSync(
  join(here, "..", "..", "offers", "private-offer-composer.tsx"),
  "utf8",
);
const OFFER_ACTIONS = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(producer)",
    "dashboard",
    "store",
    "private-offer-actions.ts",
  ),
  "utf8",
);
const CLIENT_PAGE = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "app",
    "(producer)",
    "dashboard",
    "clients-projects",
    "clients",
    "[id]",
    "page.tsx",
  ),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex, `Missing source start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `Missing source end marker: ${end}`).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("Client Space project boundaries", () => {
  it("keeps active work separate from completed and canceled archive history", () => {
    expect(isArchivedClientSpaceProject({ lifecycleStatus: "waiting_for_payment" })).toBe(false);
    expect(isArchivedClientSpaceProject({ lifecycleStatus: "active" })).toBe(false);
    expect(isArchivedClientSpaceProject({ lifecycleStatus: "paused" })).toBe(false);
    expect(isArchivedClientSpaceProject({ lifecycleStatus: "completed" })).toBe(true);
    expect(isArchivedClientSpaceProject({ lifecycleStatus: "canceled" })).toBe(true);

    expect(WORKSPACE).toMatch(
      /projects\.filter\(\(project\) => !isArchivedClientSpaceProject\(project\)\)/,
    );
    expect(WORKSPACE).toMatch(
      /projects\.filter\(\(project\) => isArchivedClientSpaceProject\(project\)\)/,
    );
    expect(WORKSPACE).toContain('label="Archived"');
  });

  it("makes the compact row link the complete primary surface while retaining project controls", () => {
    const linkStart = PROJECT_ROW.indexOf("<Link");
    const linkEnd = PROJECT_ROW.indexOf("</Link>", linkStart);
    const titleIndex = PROJECT_ROW.indexOf("{project.title}", linkStart);
    const nextActionIndex = PROJECT_ROW.indexOf("{project.nextAction}", linkStart);
    const controlsIndex = PROJECT_ROW.indexOf("<ProjectActionControls", linkEnd);

    expect(linkStart).toBeGreaterThanOrEqual(0);
    expect(linkEnd).toBeGreaterThan(linkStart);
    expect(titleIndex).toBeGreaterThan(linkStart);
    expect(titleIndex).toBeLessThan(linkEnd);
    expect(nextActionIndex).toBeGreaterThan(titleIndex);
    expect(nextActionIndex).toBeLessThan(linkEnd);
    expect(controlsIndex).toBeGreaterThan(linkEnd);
    expect(PROJECT_ROW).toMatch(
      /href=\{`\/dashboard\/clients-projects\/\$\{encodeURIComponent\(project\.id\)\}`\}/,
    );
    expect(PROJECT_ROW).toMatch(/aria-label=\{`Open project \$\{project\.title\}`\}/);
    expect(PROJECT_ROW).toMatch(/data-tab-swipe-ignore/);
    expect(PROJECT_ROW).toMatch(
      /<ProjectActionControls[\s\S]*?project=\{project\}[\s\S]*?lifecycleSuccessFocusRef=\{lifecycleSuccessFocusRef\}/,
    );
  });
});

describe("Client Space action boundaries", () => {
  it("limits the + bottom sheet to New Project and New Offer", () => {
    const addSheet = sourceBetween(WORKSPACE, 'data-testid="client-add-sheet"', "</SheetContent>");
    const labels = [...addSheet.matchAll(/<AddActionButton[\s\S]*?\blabel="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(labels).toEqual(["New Project", "New Offer"]);
    expect(addSheet).not.toMatch(/\bEdit\b|\bArchive\b|\bRestore\b|\bDelete\b/);
  });

  it("keeps Edit and Archive or Restore in the existing client kebab", () => {
    const header = sourceBetween(
      WORKSPACE,
      "function CompactClientHeader",
      "function ProjectsPanel",
    );

    expect(header).toMatch(
      /<ClientActionsMenu[\s\S]*?archived=\{client\.archived\}[\s\S]*?onEdit=\{onEdit\}[\s\S]*?onArchive=\{onArchive\}/,
    );
    expect(WORKSPACE).toMatch(/<ClientArchiveConfirmModal[\s\S]*?archived:\s*client\.archived/);
  });

  it("passes an explicit return target to project, invite, and offer dialogs", () => {
    expect(WORKSPACE).toMatch(/<NewProjectModal[\s\S]*?returnFocusRef=\{actionReturnFocusRef\}/);
    expect(WORKSPACE).toMatch(/<InviteToAppModal[\s\S]*?returnFocusRef=\{actionReturnFocusRef\}/);
    expect(WORKSPACE).toMatch(
      /<PrivateOfferComposer[\s\S]*?trigger=\{null\}[\s\S]*?returnFocusRef=\{actionReturnFocusRef\}/,
    );

    for (const source of [NEW_PROJECT, INVITE, COMPOSER]) {
      expect(source).toMatch(/returnFocusRef\?:\s*RefObject<HTMLElement\s*\|\s*null>/);
      expect(source).toMatch(
        /onCloseAutoFocus=\{\(event\)\s*=>\s*\{[\s\S]*?returnFocusRef\?\.current[\s\S]*?event\.preventDefault\(\)[\s\S]*?target\.focus\(\)/,
      );
    }
  });
});

describe("Client Space lazy private-offer boundary", () => {
  it("does not load offer history in the server page or before Details is selected", () => {
    expect(CLIENT_PAGE).not.toMatch(/caller\.[\w.]*privateOffers?|loadClientPrivateOffersAction/);
    expect(WORKSPACE).toMatch(/if \(activeTab !== "details"\) return/);
    expect(WORKSPACE).toMatch(/const requestKey = `\$\{client\.id\}:\$\{String\(offerReload\)\}`/);
    expect(WORKSPACE).toMatch(/if \(offerRequestKeyRef\.current === requestKey\) return/);
    expect(WORKSPACE).toMatch(/offerRequestKeyRef\.current = requestKey/);
    expect(WORKSPACE).toMatch(/loadClientPrivateOffersAction\(client\.id\)/);
    expect(WORKSPACE).toMatch(
      /offerRequestKeyRef\.current !== requestKey \|\|[\s\S]*?offerRequestGenerationRef\.current !== requestGeneration/,
    );
    expect(WORKSPACE).toMatch(
      /offerRequestGenerationRef\.current \+= 1;[\s\S]*?offerRequestKeyRef\.current = null;[\s\S]*?setOfferReload/,
    );
    expect(WORKSPACE).toMatch(/\}, \[activeTab, client\.id, offerReload\]\)/);
    expect(WORKSPACE).not.toMatch(/\[activeTab, client\.id, offerHistory\.status, offerReload\]/);

    const tabHandlers = sourceBetween(WORKSPACE, 'role="tablist"', "data-tab-swipe-surface");
    expect(tabHandlers).not.toContain("loadClientPrivateOffersAction");
  });

  it("loads through an authenticated producer caller and filters to the requested client", () => {
    const action = sourceBetween(
      OFFER_ACTIONS,
      "export async function loadClientPrivateOffersAction",
      "export async function sendPrivateOfferAction",
    );

    expect(OFFER_ACTIONS).toMatch(/^"use server"/);
    expect(action).toMatch(/const \{ userId \} = await auth\(\)/);
    expect(action).toMatch(/if \(!userId\) return \{ ok: false, error: "Not signed in" \}/);
    expect(action).toMatch(/appRouter\.createCaller\(\{ userId \}\)/);
    expect(action).toMatch(/caller\.privateOffers\.producerList\(\)/);
    expect(action).toMatch(/\.filter\(\(offer\) => offer\.clientContactId === clientContactId\)/);
    expect(action).not.toMatch(/db\.|from\(|select\(/);
  });
});

describe("Client Space narrow-layout contract", () => {
  it("keeps the 360px and 390px surfaces shrinkable without horizontal scroll escapes", () => {
    for (const source of [WORKSPACE, PROJECT_ROW]) {
      expect(source).toContain("min-w-0");
      expect(source).not.toMatch(
        /min-w-\[(?:\d+px|[4-9]\d{2}px)\]|min-width:\s*\d+px|overflow-x-(?:auto|scroll)|\bw-screen\b/,
      );
    }

    expect(WORKSPACE).toMatch(/grid w-full max-w-\[760px\] grid-cols-3/);
    expect(PROJECT_ROW).toContain("w-[min(280px,calc(100vw-3rem))]");
  });
});
