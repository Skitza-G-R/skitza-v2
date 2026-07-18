import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { canCreatePurchaseOwnedProjectWork } from "../project-upload-access";

const here = dirname(fileURLToPath(import.meta.url));
const controls = readFileSync(join(here, "..", "project-action-controls.tsx"), "utf8");
const edit = readFileSync(join(here, "..", "edit-project-dialog.tsx"), "utf8");
const lifecycle = readFileSync(join(here, "..", "project-lifecycle-dialog.tsx"), "utf8");
const deletion = readFileSync(join(here, "..", "delete-empty-project-dialog.tsx"), "utf8");
const purchases = readFileSync(join(here, "..", "project-purchases-panel.tsx"), "utf8");

describe("SK-12 project lifecycle controls", () => {
  it("does not restore upload authority when a canceled purchase's project is reopened", () => {
    expect(
      canCreatePurchaseOwnedProjectWork({
        projectLifecycleStatus: "active",
        purchaseId: "purchase-1",
        purchases: [{ id: "purchase-1", lifecycleStatus: "canceled" }],
      }),
    ).toBe(false);
    expect(
      canCreatePurchaseOwnedProjectWork({
        projectLifecycleStatus: "active",
        purchaseId: "purchase-1",
        purchases: [{ id: "purchase-1", lifecycleStatus: "active" }],
      }),
    ).toBe(true);
  });

  it("offers edit plus the legal lifecycle action for active and archived work", () => {
    expect(controls).toContain('data-project-action="edit"');
    expect(controls).toContain('data-project-action="complete"');
    expect(controls).toContain('data-project-action="cancel"');
    expect(controls).toContain('data-project-action="reopen"');
    expect(controls).toMatch(
      /lifecycleStatus === "completed"[\s\S]*?lifecycleStatus === "canceled"/,
    );
    expect(controls).toMatch(/lifecycleStatus === "active"[\s\S]*?lifecycleStatus === "paused"/);
  });

  it("edits only project name, deadline, and project workflow while showing the client read-only", () => {
    expect(edit).toContain("Project name");
    expect(edit).toContain('type="date"');
    expect(edit).toContain("Project workflow");
    expect(edit).toContain("Client · read-only");
    expect(edit).toContain("cannot be changed");
    expect(edit).not.toMatch(/name=["']client(Contact)?Id/);
  });

  it("states the permanent effects of Complete, Cancel, and Reopen before mutation", () => {
    expect(lifecycle).toContain("New uploads and comments stop.");
    expect(lifecycle).toContain("Only future installments are canceled.");
    expect(lifecycle).toContain("No refund, credit, or money movement happens automatically.");
    expect(lifecycle).toContain("Any unused session allowance closes permanently.");
    expect(lifecycle).toContain("Canceled payment schedules stay canceled.");
    expect(lifecycle).toContain("Closed session allowance stays closed.");
  });

  it("requires a reason and cancels one purchase without implying that project status changes", () => {
    expect(purchases).toMatch(/The project status does\s+not\s+change\./);
    expect(purchases).not.toContain("The project stays open.");
    expect(purchases).toContain("Cancellation reason");
    expect(purchases).toContain("cancelProjectPurchaseAction");
    expect(purchases).toContain("Due and overdue amounts remain unless explicitly waived.");
    expect(purchases).toContain("No refund, credit, or money movement happens automatically.");
    expect(purchases).toContain(
      "Any unused session allowance tied to this purchase closes permanently.",
    );
    expect(purchases).toMatch(/Installment \{installment\.position\}/);
    expect(purchases).not.toMatch(/installment\.position\s*\+\s*1/);
  });

  it("shows permanent deletion only from the server advisory and repeats the empty-history rule", () => {
    expect(controls).toMatch(/project\.canDeleteEmptyDraft[\s\S]*?data-project-action="delete"/);
    expect(deletion).toContain("Deletion is allowed only while this draft is truly empty.");
    expect(deletion).toContain(
      "commercial, song, version, comment, session, or public-link history",
    );
  });

  it("keeps row and project-page actions usable at phone widths", () => {
    expect(controls).toContain("flex-wrap");
    expect(controls).toContain("min-h-11");
  });
});
