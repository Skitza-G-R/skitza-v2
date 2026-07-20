import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const router = readFileSync(join(__dirname, "../project.ts"), "utf8");
const db = readFileSync(join(__dirname, "../../../domain/project-lifecycle/db.ts"), "utf8");

function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("SK-12 project lifecycle router boundary", () => {
  it("accepts only mutable project metadata and never accepts a client owner", () => {
    const input = block(router, "const UpdateProjectInput", "const AddTrackInput");
    expect(input).toContain("title:");
    expect(input).toContain("deadlineAt:");
    expect(input).toContain("workflowStage:");
    expect(input).toContain(".strict()");
    expect(input).not.toMatch(/clientContactId|clientId|artistEmail|clientEmail/);
  });

  it("keeps lifecycle mutations thin and delegates them to the focused domain", () => {
    const lifecycle = block(router, "  update: producerProcedure", "  deleteEmptyDraft:");
    expect(lifecycle).toContain("editProject(projectLifecycleRepository(ctx.db)");
    expect(lifecycle).toContain("completeProject(projectLifecycleRepository(ctx.db)");
    expect(lifecycle).toContain("cancelProjectLifecycle(projectLifecycleRepository(ctx.db)");
    expect(lifecycle).toContain("reopenProject(projectLifecycleRepository(ctx.db)");
    expect(lifecycle).toContain("cancelProjectPurchase(projectLifecycleRepository(ctx.db)");
    expect(lifecycle).not.toMatch(/ctx\.db\s*\.update\((projects|purchases|purchaseInstallments)/);
  });

  it("maps transition and concurrency failures into actionable tRPC conflicts", () => {
    const mapper = block(router, "function mapProjectLifecycleDomainError", "type Stage");
    expect(mapper).toContain('error.code === "INVALID_TRANSITION"');
    expect(mapper).toContain('code: "PRECONDITION_FAILED"');
    expect(mapper).toContain('error.code === "CONCURRENT_CHANGE"');
    expect(mapper).toContain('code: "CONFLICT"');
  });

  it("returns producer-scoped purchase schedules and an advisory empty-draft result", () => {
    const detail = block(router, "  detail: producerProcedure", "  create: producerProcedure");
    expect(detail).toContain("canPermanentlyDeleteEmptyDraftProject");
    expect(detail).toContain("eq(purchases.producerId, ctx.producerId)");
    expect(detail).toContain("eq(purchaseInstallments.producerId, ctx.producerId)");
    expect(detail).toContain("commercialSnapshot: purchases.commercialSnapshot");
  });

  it("locks every lifecycle write inside the same producer and project scope", () => {
    expect(db).toContain("eq(projects.producerId, scope.producerId)");
    expect(db).toContain("eq(purchases.producerId, scope.producerId)");
    expect(db).toContain("eq(purchases.projectId, scope.projectId)");
    expect(db).toContain("pg_advisory_xact_lock");
    expect(db).toContain("purchaseLedgerAdvisoryLockKey(purchaseId)");
    expect(db).toContain("purchaseLedgerAdvisoryLockKey(scope.purchaseId)");
    expect(db).toContain("purchaseLedgerRepositoryForTransaction(tx");
  });
});
