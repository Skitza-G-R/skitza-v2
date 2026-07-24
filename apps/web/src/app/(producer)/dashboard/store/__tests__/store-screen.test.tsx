import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "store-screen.tsx"), "utf8");

describe("StoreScreen shell", () => {
  it("uses the existing tRPC server actions", () => {
    expect(SRC).toMatch(/setPackageActive/);
  });

  it("wires the / and N global keyboard shortcuts", () => {
    expect(SRC).toMatch(/key === "\/"|"\\\/"/);
    expect(SRC).toMatch(/key\.toLowerCase\(\) === "n"|key === "N"|key === "n"/);
  });

  it("does NOT link Create or Edit to /dashboard/settings (regression carryover)", () => {
    expect(SRC).not.toMatch(/href\s*=\s*[`"']\/dashboard\/settings\?section=services/);
  });

  it("renders the StoreHeader, StoreToolbar, ProductCard, EmptyState pieces", () => {
    expect(SRC).toMatch(/StoreHeader/);
    expect(SRC).toMatch(/StoreToolbar/);
    expect(SRC).toMatch(/ProductCard/);
    expect(SRC).toMatch(/EmptyState/);
  });

  it("renders the HIDDEN section divider when filter is all", () => {
    expect(SRC).toMatch(/HIDDEN/);
  });

  it("no longer uses window.confirm anywhere", () => {
    expect(SRC).not.toMatch(/window\.confirm/);
  });

  it("mounts the new ProductEditor", () => {
    expect(SRC).toMatch(/<ProductEditor/);
  });

  it("defines StoreProduct without old deposit compatibility fields", () => {
    expect(SRC).toMatch(/paymentPlans:\s*import\("@skitza\/db"\)\.PaymentPlan\[\]/);
    expect(SRC).not.toMatch(/depositPct|depositModel|milestones/);
  });

  it("mounts the lifecycle-aware ProductRemovalModal", () => {
    expect(SRC).toMatch(/<ProductRemovalModal/);
  });

  it("no longer mounts NewPackageForm directly", () => {
    expect(SRC).not.toMatch(/NewPackageForm/);
  });

  it("uses useProductRemoval for the archive/delete outcome flow", () => {
    expect(SRC).toMatch(/useProductRemoval/);
  });

  it("calls reorderProducts with the complete ordered id list after an accessible move", () => {
    expect(SRC).toMatch(/function moveProduct/);
    expect(SRC).toMatch(/nextProducts\.map\(\(product\) => product\.id\)/);
    expect(SRC).toMatch(/reorderProducts\(\s*\{\s*orderedIds/);
  });

  it("reverts the optimistic state to props on server error", () => {
    expect(SRC).toMatch(/setOptimisticProducts\(products\)/);
  });

  it("keeps catalog mutations live-only and reports transport failures locally", () => {
    expect(SRC).toContain("useOnlineStatus");
    expect(SRC).toContain("Reconnect to reorder products.");
    expect(SRC).toContain("Could not reorder products. Please try again.");
    expect(SRC).toContain("Could not update product visibility. Please try again.");
  });

  it("passes move-up/down state and handlers into each ProductCard", () => {
    expect(SRC).toMatch(/canMoveUp=\{index > 0\}/);
    expect(SRC).toMatch(/canMoveDown=\{index < (?:live|hidden)\.length - 1\}/);
    expect(SRC).toMatch(/onMoveUp=/);
    expect(SRC).toMatch(/onMoveDown=/);
    expect(SRC).not.toMatch(/useDragReorder|drag=\{/);
  });

  it("announces optimistic reorder outcomes to assistive technology", () => {
    expect(SRC).toMatch(/aria-live="polite"/);
    expect(SRC).toMatch(/Moved \$\{moving\.name\}/);
    expect(SRC).toMatch(/Could not move \$\{moving\.name\}/);
  });

  it("mirrors the products prop into local optimistic state", () => {
    expect(SRC).toMatch(/optimisticProducts/);
    expect(SRC).toMatch(/setOptimisticProducts/);
  });

  it("ships one card catalog with no table view or unfinished toggle", () => {
    expect(SRC).not.toMatch(/StoreTable|ViewToggle|ViewMode|enableTable/);
    expect(SRC).not.toMatch(/view\s*===\s*["']table["']/);
  });

  it("falls back to Archive until the server supplies a proven removal action", () => {
    expect(SRC).toMatch(/product\.removalAction\s*\?\?\s*["']archive["']/);
  });

  it("tracks the most-recently-created product id in state", () => {
    expect(SRC).toMatch(/recentlyAdded/);
    expect(SRC).toMatch(/setRecentlyAdded/);
  });

  it("clears recentlyAdded after 4500ms via setTimeout", () => {
    expect(SRC).toMatch(/setTimeout[\s\S]{0,300}4500|4500[\s\S]{0,300}setTimeout/);
  });

  it("passes recentlyAdded to each ProductCard via p.id equality", () => {
    expect(SRC).toMatch(/recentlyAdded=\{p\.id\s*===\s*recentlyAdded\}/);
  });

  it("wires onCreated on the create-mode ProductEditor", () => {
    expect(SRC).toMatch(/onCreated=\{handleCreated\}/);
  });

  it("keeps create and edit drafts available after an ordinary close and reopen", () => {
    const createStart = SRC.indexOf("{/* Create modal */}");
    const editStart = SRC.indexOf("{/* Edit modal */}");
    const removalStart = SRC.indexOf("<ProductRemovalModal");
    const createEditor = SRC.slice(createStart, editStart);
    const editEditor = SRC.slice(editStart, removalStart);

    for (const editor of [createEditor, editEditor]) {
      expect(editor).not.toContain("storeDraft.clear()");
      expect(editor).toContain("persistedDraft={storeDraft.record}");
      expect(editor).toContain("onPersistDraft={storeDraft.save}");
      expect(editor).toContain("onSubmitted={storeDraft.clear}");
    }
  });

  it("passes the real focal or secondary Store placement into each preview", () => {
    expect(SRC).toMatch(/previewPlacement=\{counts\.live === 0 \? "focal" : "secondary"\}/);
    expect(SRC).toMatch(/editing\?\.active && editing\.id === firstLiveProductId/);
  });

  it("does not let global shortcuts fire from controls or any open dialog", () => {
    expect(SRC).toMatch(/button, a\[href\]/);
    expect(SRC).toMatch(/\[role="dialog"\]/);
    expect(SRC).toMatch(/isContentEditable/);
    expect(SRC).toMatch(/creating \|\|/);
    expect(SRC).toMatch(/editing !== null/);
    expect(SRC).toMatch(/removing !== null/);
    expect(SRC).not.toMatch(/e\.key === "Escape"/);
  });
});
