import {
  ClerkIdentityRelinkError,
  clerkIdentityRelinkManifestDigest,
  requireClerkIdentityRelinkApproval,
  type ClerkIdentityRelinkManifest,
} from "./manifest";
import { verifyClerkRelinkProviderEvidence, type ClerkRelinkProviderReaders } from "./provider";
import {
  assertClerkIdentityRelinkInventory,
  assertClerkIdentityRelinkPlan,
  type ClerkIdentityRelinkRepository,
} from "./repository";

export type ClerkIdentityRelinkMode =
  | "inspect"
  | "rehearse"
  | "stage"
  | "activate"
  | "reject-stage";

export type SafeClerkIdentityRelinkResult = Readonly<{
  mode: ClerkIdentityRelinkMode;
  batchId: string;
  manifestDigest: string;
  principalCount: 6;
  bindingCount: number;
  status: "inspected" | "rehearsed" | "staged" | "active" | "rejected";
}>;

export type ClerkIdentityRelinkDependencies = Readonly<{
  approval?: string;
  configuredProducerInvitationCutoff: string;
  manifest: ClerkIdentityRelinkManifest;
  now?: () => Date;
  providers: ClerkRelinkProviderReaders;
  repository: ClerkIdentityRelinkRepository;
}>;

async function preflight(dependencies: ClerkIdentityRelinkDependencies): Promise<void> {
  if (
    dependencies.configuredProducerInvitationCutoff !==
    dependencies.manifest.producerInvitationCutoff
  ) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }
  await verifyClerkRelinkProviderEvidence(dependencies.providers, dependencies.manifest);
  const inventory = await dependencies.repository.inventory(
    dependencies.manifest.principals.map((item) => item.canonicalClerkUserId),
  );
  assertClerkIdentityRelinkInventory(dependencies.manifest, inventory);
  if ((await dependencies.repository.targetIdentitiesOccupied(dependencies.manifest)).length > 0) {
    throw new ClerkIdentityRelinkError("RELINK_INVENTORY_MISMATCH");
  }
}

/**
 * Rehearsal and every mutation rerun the exact provider and role inventory
 * proof. No operation derives an identity pair from email.
 */
export async function executeClerkIdentityRelink(
  mode: ClerkIdentityRelinkMode,
  dependencies: ClerkIdentityRelinkDependencies,
): Promise<SafeClerkIdentityRelinkResult> {
  const digest = clerkIdentityRelinkManifestDigest(dependencies.manifest);
  if (mode === "inspect") {
    const batchRows = await dependencies.repository.inspectBatch(dependencies.manifest.batchId);
    const rows =
      batchRows.length === 0
        ? batchRows
        : await dependencies.repository.inspectPlan(dependencies.manifest);
    if (rows.length > 0) assertClerkIdentityRelinkPlan(dependencies.manifest, rows);
    return {
      mode,
      batchId: dependencies.manifest.batchId,
      manifestDigest: digest,
      principalCount: 6,
      bindingCount: rows.length,
      status: "inspected",
    };
  }

  if (mode !== "reject-stage") await preflight(dependencies);
  if (mode === "rehearse") {
    const batchRows = await dependencies.repository.inspectBatch(dependencies.manifest.batchId);
    const rows =
      batchRows.length === 0
        ? batchRows
        : await dependencies.repository.inspectPlan(dependencies.manifest);
    if (rows.length !== 0) assertClerkIdentityRelinkPlan(dependencies.manifest, rows);
    return {
      mode,
      batchId: dependencies.manifest.batchId,
      manifestDigest: digest,
      principalCount: 6,
      bindingCount: rows.length,
      status: "rehearsed",
    };
  }

  requireClerkIdentityRelinkApproval(mode, dependencies.manifest, dependencies.approval);
  const now = (dependencies.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime())) {
    throw new ClerkIdentityRelinkError("RELINK_MANIFEST_INVALID");
  }

  if (mode === "stage") {
    const existing = await dependencies.repository.inspectBatch(dependencies.manifest.batchId);
    if (existing.length !== 0) {
      throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
    }
    await dependencies.repository.stage(dependencies.manifest, now);
    const rows = await dependencies.repository.inspectPlan(dependencies.manifest);
    assertClerkIdentityRelinkPlan(dependencies.manifest, rows, "staged");
    return {
      mode,
      batchId: dependencies.manifest.batchId,
      manifestDigest: digest,
      principalCount: 6,
      bindingCount: rows.length,
      status: "staged",
    };
  }

  const before = await dependencies.repository.inspectPlan(dependencies.manifest);
  assertClerkIdentityRelinkPlan(dependencies.manifest, before, "staged");
  if (mode === "activate") {
    await dependencies.repository.activate(dependencies.manifest, now);
    const rows = await dependencies.repository.inspectPlan(dependencies.manifest);
    assertClerkIdentityRelinkPlan(dependencies.manifest, rows, "active");
    return {
      mode,
      batchId: dependencies.manifest.batchId,
      manifestDigest: digest,
      principalCount: 6,
      bindingCount: rows.length,
      status: "active",
    };
  }

  await dependencies.repository.rejectStage(dependencies.manifest, now);
  const rows = await dependencies.repository.inspectPlan(dependencies.manifest);
  assertClerkIdentityRelinkPlan(dependencies.manifest, rows, "revoked");
  return {
    mode,
    batchId: dependencies.manifest.batchId,
    manifestDigest: digest,
    principalCount: 6,
    bindingCount: rows.length,
    status: "rejected",
  };
}
