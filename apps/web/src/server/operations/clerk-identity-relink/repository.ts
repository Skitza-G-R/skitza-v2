import {
  and,
  clerkIdentityBindings,
  clientContacts,
  eq,
  or,
  producers,
  registeredAccounts,
  sql,
  type Db,
  type NewClerkIdentityBinding,
} from "@skitza/db";

import {
  ClerkIdentityRelinkError,
  clerkIdentityRelinkManifestDigest,
  type ClerkIdentityRelinkManifest,
  type ClerkIdentityRelinkPrincipal,
} from "./manifest";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ClerkIdentityRelinkInventory = Readonly<{
  canonicalClerkUserId: string;
  hasProducerRole: boolean;
  artistLinkCount: number;
  terminalDeleted: boolean;
}>;

export type ClerkIdentityRelinkBindingRow = Readonly<{
  id: string;
  batchId: string;
  kind: "native" | "relink";
  status: "staged" | "active" | "revoked";
  clerkInstanceId: string;
  providerClerkUserId: string;
  canonicalClerkUserId: string;
  verifiedEmailHash: string;
  sourceClerkInstanceId: string | null;
  sourceProviderClerkUserId: string | null;
  manifestDigest: string;
  evidenceRef: string;
  activatedAt: Date | null;
  revokedAt: Date | null;
}>;

export interface ClerkIdentityRelinkRepository {
  readonly inventory: (
    canonicalClerkUserIds: readonly string[],
  ) => Promise<readonly ClerkIdentityRelinkInventory[]>;
  readonly targetIdentitiesOccupied: (
    manifest: ClerkIdentityRelinkManifest,
  ) => Promise<readonly string[]>;
  readonly inspectBatch: (batchId: string) => Promise<readonly ClerkIdentityRelinkBindingRow[]>;
  readonly inspectPlan: (
    manifest: ClerkIdentityRelinkManifest,
  ) => Promise<readonly ClerkIdentityRelinkBindingRow[]>;
  readonly stage: (manifest: ClerkIdentityRelinkManifest, stagedAt: Date) => Promise<void>;
  readonly activate: (manifest: ClerkIdentityRelinkManifest, activatedAt: Date) => Promise<void>;
  readonly rejectStage: (manifest: ClerkIdentityRelinkManifest, revokedAt: Date) => Promise<void>;
}

export function assertClerkIdentityRelinkInventory(
  manifest: ClerkIdentityRelinkManifest,
  inventory: readonly ClerkIdentityRelinkInventory[],
): void {
  const byId = new Map(inventory.map((item) => [item.canonicalClerkUserId, item]));
  if (byId.size !== 6) {
    throw new ClerkIdentityRelinkError("RELINK_INVENTORY_MISMATCH");
  }
  for (const principal of manifest.principals) {
    const actual = byId.get(principal.canonicalClerkUserId);
    const expectedProducer = principal.expectedRoles[0] === "producer";
    if (
      !actual ||
      actual.hasProducerRole !== expectedProducer ||
      actual.artistLinkCount !== principal.expectedArtistLinkCount ||
      actual.terminalDeleted
    ) {
      throw new ClerkIdentityRelinkError("RELINK_INVENTORY_MISMATCH");
    }
  }
}

function bindingValues(
  manifest: ClerkIdentityRelinkManifest,
  principal: ClerkIdentityRelinkPrincipal,
  stagedAt: Date,
): readonly [NewClerkIdentityBinding, NewClerkIdentityBinding] {
  const common = {
    batchId: manifest.batchId,
    canonicalClerkUserId: principal.canonicalClerkUserId,
    verifiedEmailHash: principal.verifiedEmailHash,
    manifestDigest: clerkIdentityRelinkManifestDigest(manifest),
    evidenceRef: manifest.evidenceRef,
  } as const;
  return [
    {
      ...common,
      kind: "native" as const,
      status: "active" as const,
      clerkInstanceId: manifest.sourceClerkInstanceId,
      providerClerkUserId: principal.canonicalClerkUserId,
      sourceClerkInstanceId: null,
      sourceProviderClerkUserId: null,
      stagedAt,
      activatedAt: stagedAt,
    },
    {
      ...common,
      kind: "relink" as const,
      status: "staged" as const,
      clerkInstanceId: manifest.targetClerkInstanceId,
      providerClerkUserId: principal.targetProviderClerkUserId,
      sourceClerkInstanceId: manifest.sourceClerkInstanceId,
      sourceProviderClerkUserId: principal.canonicalClerkUserId,
      stagedAt,
    },
  ];
}

export function assertClerkIdentityRelinkPlan(
  manifest: ClerkIdentityRelinkManifest,
  rows: readonly ClerkIdentityRelinkBindingRow[],
  expectedRelinkStatus?: "staged" | "active" | "revoked",
): void {
  const digest = clerkIdentityRelinkManifestDigest(manifest);
  const relinks = rows.filter((row) => row.kind === "relink");
  const natives = rows.filter((row) => row.kind === "native");
  if (
    rows.length !== 12 ||
    relinks.length !== 6 ||
    natives.length !== 6 ||
    new Set(rows.map((row) => row.id)).size !== 12 ||
    (expectedRelinkStatus === undefined && new Set(relinks.map((row) => row.status)).size !== 1)
  ) {
    throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
  }
  for (const principal of manifest.principals) {
    const matchingRelinks = relinks.filter(
      (row) =>
        (expectedRelinkStatus === undefined || row.status === expectedRelinkStatus) &&
        row.clerkInstanceId === manifest.targetClerkInstanceId &&
        row.providerClerkUserId === principal.targetProviderClerkUserId &&
        row.canonicalClerkUserId === principal.canonicalClerkUserId &&
        row.batchId === manifest.batchId &&
        row.verifiedEmailHash === principal.verifiedEmailHash &&
        row.sourceClerkInstanceId === manifest.sourceClerkInstanceId &&
        row.sourceProviderClerkUserId === principal.canonicalClerkUserId &&
        row.manifestDigest === digest &&
        row.evidenceRef === manifest.evidenceRef,
    );
    const matchingNatives = natives.filter(
      (row) =>
        row.clerkInstanceId === manifest.sourceClerkInstanceId &&
        row.providerClerkUserId === principal.canonicalClerkUserId &&
        row.canonicalClerkUserId === principal.canonicalClerkUserId &&
        row.status === "active" &&
        row.verifiedEmailHash === principal.verifiedEmailHash &&
        row.sourceClerkInstanceId === null &&
        row.sourceProviderClerkUserId === null &&
        row.activatedAt !== null &&
        row.revokedAt === null &&
        (row.batchId !== manifest.batchId ||
          (row.manifestDigest === digest && row.evidenceRef === manifest.evidenceRef)),
    );
    if (matchingRelinks.length !== 1 || matchingNatives.length !== 1) {
      throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
    }
  }

  const lifecycleValid = relinks.every((row) => {
    if (row.status === "staged") return row.activatedAt === null && row.revokedAt === null;
    if (row.status === "active") return row.activatedAt !== null && row.revokedAt === null;
    return row.revokedAt !== null;
  });
  if (!lifecycleValid) {
    throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
  }
}

async function lockBatch(tx: TransactionDb, batchId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`clerk-identity-relink:${batchId}`}, 0))`,
  );
}

async function inventoryWithDb(
  db: Pick<Db, "select">,
  canonicalClerkUserIds: readonly string[],
): Promise<readonly ClerkIdentityRelinkInventory[]> {
  return Promise.all(
    canonicalClerkUserIds.map(async (canonicalClerkUserId) => {
      const [producerRows, artistRows, accountRows] = await Promise.all([
        db
          .select({ id: producers.id })
          .from(producers)
          .where(eq(producers.clerkUserId, canonicalClerkUserId))
          .limit(2),
        db
          .select({ id: clientContacts.id })
          .from(clientContacts)
          .where(eq(clientContacts.clerkUserId, canonicalClerkUserId)),
        db
          .select({ providerState: registeredAccounts.providerState })
          .from(registeredAccounts)
          .where(eq(registeredAccounts.clerkUserId, canonicalClerkUserId))
          .limit(2),
      ]);
      return {
        canonicalClerkUserId,
        hasProducerRole: producerRows.length === 1,
        artistLinkCount: artistRows.length,
        terminalDeleted: accountRows.some((row) => row.providerState === "deleted"),
      };
    }),
  );
}

const bindingSelection = {
  id: clerkIdentityBindings.id,
  batchId: clerkIdentityBindings.batchId,
  kind: clerkIdentityBindings.kind,
  status: clerkIdentityBindings.status,
  clerkInstanceId: clerkIdentityBindings.clerkInstanceId,
  providerClerkUserId: clerkIdentityBindings.providerClerkUserId,
  canonicalClerkUserId: clerkIdentityBindings.canonicalClerkUserId,
  verifiedEmailHash: clerkIdentityBindings.verifiedEmailHash,
  sourceClerkInstanceId: clerkIdentityBindings.sourceClerkInstanceId,
  sourceProviderClerkUserId: clerkIdentityBindings.sourceProviderClerkUserId,
  manifestDigest: clerkIdentityBindings.manifestDigest,
  evidenceRef: clerkIdentityBindings.evidenceRef,
  activatedAt: clerkIdentityBindings.activatedAt,
  revokedAt: clerkIdentityBindings.revokedAt,
} as const;

async function inspectBatchWithDb(
  db: Pick<Db, "select">,
  batchId: string,
): Promise<readonly ClerkIdentityRelinkBindingRow[]> {
  return db
    .select(bindingSelection)
    .from(clerkIdentityBindings)
    .where(eq(clerkIdentityBindings.batchId, batchId));
}

async function inspectPlanWithDb(
  db: Pick<Db, "select">,
  manifest: ClerkIdentityRelinkManifest,
): Promise<readonly ClerkIdentityRelinkBindingRow[]> {
  const [batchRows, nativeRowsByPrincipal] = await Promise.all([
    inspectBatchWithDb(db, manifest.batchId),
    Promise.all(
      manifest.principals.map((principal) =>
        db
          .select(bindingSelection)
          .from(clerkIdentityBindings)
          .where(
            and(
              eq(clerkIdentityBindings.kind, "native"),
              eq(clerkIdentityBindings.status, "active"),
              eq(clerkIdentityBindings.clerkInstanceId, manifest.sourceClerkInstanceId),
              eq(clerkIdentityBindings.providerClerkUserId, principal.canonicalClerkUserId),
              eq(clerkIdentityBindings.canonicalClerkUserId, principal.canonicalClerkUserId),
            ),
          )
          .limit(2),
      ),
    ),
  ]);
  const rows = new Map<string, ClerkIdentityRelinkBindingRow>();
  for (const row of [...batchRows, ...nativeRowsByPrincipal.flat()]) {
    rows.set(row.id, row);
  }
  return [...rows.values()];
}

async function targetIdentitiesOccupiedWithDb(
  db: Pick<Db, "select">,
  manifest: ClerkIdentityRelinkManifest,
): Promise<readonly string[]> {
  const occupied = await Promise.all(
    manifest.principals.map(async (principal) => {
      const targetId = principal.targetProviderClerkUserId;
      const [producerRows, artistRows, accountRows] = await Promise.all([
        db
          .select({ id: producers.id })
          .from(producers)
          .where(eq(producers.clerkUserId, targetId))
          .limit(1),
        db
          .select({ id: clientContacts.id })
          .from(clientContacts)
          .where(eq(clientContacts.clerkUserId, targetId))
          .limit(1),
        db
          .select({ clerkUserId: registeredAccounts.clerkUserId })
          .from(registeredAccounts)
          .where(
            or(
              eq(registeredAccounts.clerkUserId, targetId),
              and(
                eq(registeredAccounts.clerkInstanceId, manifest.targetClerkInstanceId),
                eq(registeredAccounts.providerClerkUserId, targetId),
              ),
            ),
          )
          .limit(1),
      ]);
      return producerRows.length > 0 || artistRows.length > 0 || accountRows.length > 0
        ? targetId
        : null;
    }),
  );
  return occupied.filter((targetId): targetId is string => targetId !== null);
}

export function createClerkIdentityRelinkRepository(db: Db): ClerkIdentityRelinkRepository {
  const inspectBatch: ClerkIdentityRelinkRepository["inspectBatch"] = (batchId: string) =>
    inspectBatchWithDb(db, batchId);

  return Object.freeze({
    inventory: (ids: readonly string[]) => inventoryWithDb(db, ids),
    targetIdentitiesOccupied: (manifest: ClerkIdentityRelinkManifest) =>
      targetIdentitiesOccupiedWithDb(db, manifest),
    inspectBatch,
    inspectPlan: (manifest: ClerkIdentityRelinkManifest) => inspectPlanWithDb(db, manifest),

    async stage(manifest: ClerkIdentityRelinkManifest, stagedAt: Date) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        await lockBatch(tx, manifest.batchId);
        const readableTx = tx as unknown as Pick<Db, "select">;
        const [inventory, occupiedTargets, existingBatch] = await Promise.all([
          inventoryWithDb(
            readableTx,
            manifest.principals.map((item) => item.canonicalClerkUserId),
          ),
          targetIdentitiesOccupiedWithDb(readableTx, manifest),
          inspectBatchWithDb(readableTx, manifest.batchId),
        ]);
        assertClerkIdentityRelinkInventory(manifest, inventory);
        if (occupiedTargets.length > 0 || existingBatch.length > 0) {
          throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
        }
        const values: NewClerkIdentityBinding[] = [];
        for (const principal of manifest.principals) {
          const [native, relink] = bindingValues(manifest, principal, stagedAt);
          const existingNative = await tx
            .select({
              verifiedEmailHash: clerkIdentityBindings.verifiedEmailHash,
            })
            .from(clerkIdentityBindings)
            .where(
              and(
                eq(clerkIdentityBindings.kind, "native"),
                eq(clerkIdentityBindings.status, "active"),
                eq(clerkIdentityBindings.clerkInstanceId, manifest.sourceClerkInstanceId),
                eq(clerkIdentityBindings.providerClerkUserId, principal.canonicalClerkUserId),
                eq(clerkIdentityBindings.canonicalClerkUserId, principal.canonicalClerkUserId),
              ),
            )
            .limit(2);
          if (existingNative.length > 1) {
            throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
          }
          if (existingNative.length === 0) {
            values.push(native);
          } else if (existingNative[0]?.verifiedEmailHash !== principal.verifiedEmailHash) {
            throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
          }
          values.push(relink);
        }
        const inserted = await tx
          .insert(clerkIdentityBindings)
          .values(values)
          .onConflictDoNothing()
          .returning({ id: clerkIdentityBindings.id });
        if (inserted.length !== values.length) {
          throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
        }
        const planRows = await inspectPlanWithDb(readableTx, manifest);
        assertClerkIdentityRelinkPlan(manifest, planRows, "staged");
      });
    },

    async activate(manifest: ClerkIdentityRelinkManifest, activatedAt: Date) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        await lockBatch(tx, manifest.batchId);
        const expectedDigest = clerkIdentityRelinkManifestDigest(manifest);
        const readableTx = tx as unknown as Pick<Db, "select">;
        const planRows = await inspectPlanWithDb(readableTx, manifest);
        assertClerkIdentityRelinkPlan(manifest, planRows, "staged");
        const updated = await tx
          .update(clerkIdentityBindings)
          .set({ status: "active", activatedAt })
          .where(
            and(
              eq(clerkIdentityBindings.batchId, manifest.batchId),
              eq(clerkIdentityBindings.manifestDigest, expectedDigest),
              eq(clerkIdentityBindings.kind, "relink"),
              eq(clerkIdentityBindings.status, "staged"),
            ),
          )
          .returning({ id: clerkIdentityBindings.id });
        if (updated.length !== 6) {
          throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
        }
        assertClerkIdentityRelinkPlan(
          manifest,
          await inspectPlanWithDb(readableTx, manifest),
          "active",
        );
      });
    },

    async rejectStage(manifest: ClerkIdentityRelinkManifest, revokedAt: Date) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        await lockBatch(tx, manifest.batchId);
        const expectedDigest = clerkIdentityRelinkManifestDigest(manifest);
        const readableTx = tx as unknown as Pick<Db, "select">;
        const planRows = await inspectPlanWithDb(readableTx, manifest);
        assertClerkIdentityRelinkPlan(manifest, planRows, "staged");
        const updated = await tx
          .update(clerkIdentityBindings)
          .set({ status: "revoked", revokedAt })
          .where(
            and(
              eq(clerkIdentityBindings.batchId, manifest.batchId),
              eq(clerkIdentityBindings.manifestDigest, expectedDigest),
              eq(clerkIdentityBindings.kind, "relink"),
              eq(clerkIdentityBindings.status, "staged"),
            ),
          )
          .returning({ id: clerkIdentityBindings.id });
        if (updated.length !== 6) {
          throw new ClerkIdentityRelinkError("RELINK_BINDING_CONFLICT");
        }
        assertClerkIdentityRelinkPlan(
          manifest,
          await inspectPlanWithDb(readableTx, manifest),
          "revoked",
        );
      });
    },
  });
}
