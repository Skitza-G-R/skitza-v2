import {
  accountClosureEvents,
  accountClosureRequests,
  accountClosureTasks,
  and,
  artistNotifications,
  artistProfiles,
  eq,
  firstVersionUploadIntents,
  googleCalendarConnections,
  gt,
  inArray,
  isNotNull,
  isNull,
  projectTracks,
  projects,
  producers,
  pushSubscriptions,
  songPublicLinks,
  sql,
  trackVersions,
  type AccountClosureRequest,
  type Db,
} from "@skitza/db";

import {
  ACCOUNT_CLOSURE_TASKS,
  AccountClosureError,
  accountClosureOperationDigest,
  isAccountClosureLegalHoldActive,
  isAccountClosureRunningTaskLeaseActive,
  type AccountClosureRequestRecord,
  type AccountClosureStore,
  type AccountClosureTaskKind,
  type ClaimedAccountClosureTask,
} from "./account-closure";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

const ACCOUNT_CLOSURE_CAPABILITY_EXPIRY_MS = 15 * 60 * 1_000;

function requestRecord(row: AccountClosureRequest): AccountClosureRequestRecord {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    status: row.status,
    closureStartedAt: row.closureStartedAt,
    accessRevokedAt: row.accessRevokedAt,
    dueAt: row.dueAt,
    legalHoldAt: row.legalHoldAt,
    legalHoldReleasedAt: row.legalHoldReleasedAt,
  };
}

async function lockedRequest(tx: TransactionDb, requestId: string): Promise<AccountClosureRequest> {
  const [row] = await tx
    .select()
    .from(accountClosureRequests)
    .where(eq(accountClosureRequests.id, requestId))
    .limit(1)
    .for("update");
  if (!row) throw new AccountClosureError("account_closure_not_found");
  return row;
}

async function transactionNow(tx: TransactionDb): Promise<Date> {
  const result = await tx.execute<{ transactionNow: Date | string }>(
    sql`select transaction_timestamp() as "transactionNow"`,
  );
  const raw = result.rows[0]?.transactionNow;
  const value = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  if (!value || !Number.isFinite(value.getTime())) {
    throw new AccountClosureError("account_closure_conflict");
  }
  return value;
}

async function databaseWallClockNow(tx: TransactionDb): Promise<Date> {
  const result = await tx.execute<{ databaseNow: Date | string }>(
    sql`select clock_timestamp() as "databaseNow"`,
  );
  const raw = result.rows[0]?.databaseNow;
  const value = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  if (!value || !Number.isFinite(value.getTime())) {
    throw new AccountClosureError("account_closure_conflict");
  }
  return value;
}

async function localCapabilitiesAreRevoked(
  tx: TransactionDb,
  input: { producerId: string; closedAt: Date; checkedAt: Date },
): Promise<boolean> {
  if (input.checkedAt.getTime() < input.closedAt.getTime() + ACCOUNT_CLOSURE_CAPABILITY_EXPIRY_MS) {
    return false;
  }

  const [activeLink] = await tx
    .select({ id: songPublicLinks.id })
    .from(songPublicLinks)
    .where(
      and(eq(songPublicLinks.producerId, input.producerId), isNull(songPublicLinks.disabledAt)),
    )
    .limit(1);
  const [publishedTrack] = await tx
    .select({ id: projectTracks.id })
    .from(projectTracks)
    .innerJoin(projects, eq(projects.id, projectTracks.projectId))
    .where(
      and(eq(projects.producerId, input.producerId), isNotNull(projectTracks.portfolioPublishedAt)),
    )
    .limit(1);
  const [unexpiredFirstUploadCapability] = await tx
    .select({ id: firstVersionUploadIntents.id })
    .from(firstVersionUploadIntents)
    .where(
      and(
        eq(firstVersionUploadIntents.producerId, input.producerId),
        gt(firstVersionUploadIntents.latestUploadUrlExpiresAt, input.checkedAt),
      ),
    )
    .limit(1);
  const [unexpiredMultipartCapability] = await tx
    .select({ id: trackVersions.id })
    .from(trackVersions)
    .where(
      and(
        eq(trackVersions.producerId, input.producerId),
        gt(trackVersions.pendingAudioPartUrlsExpireAt, input.checkedAt),
      ),
    )
    .limit(1);

  return !(
    activeLink ||
    publishedTrack ||
    unexpiredFirstUploadCapability ||
    unexpiredMultipartCapability
  );
}

async function appendEvent(
  tx: TransactionDb,
  input: {
    requestId: string;
    eventType:
      | "requested"
      | "identity_verified"
      | "closure_started"
      | "access_revoked"
      | "task_started"
      | "task_blocked"
      | "task_succeeded"
      | "task_not_applicable"
      | "legal_hold_applied"
      | "legal_hold_released"
      | "completed";
    taskKind?: AccountClosureTaskKind;
    actorClerkUserId: string;
    operationKey: string;
    evidenceRef?: string;
    occurredAt: Date;
  },
): Promise<void> {
  const operationDigest = accountClosureOperationDigest({
    actorClerkUserId: input.actorClerkUserId,
    eventType: input.eventType,
    evidenceRef: input.evidenceRef ?? null,
    occurredAt: input.occurredAt,
    requestId: input.requestId,
    taskKind: input.taskKind ?? null,
  });
  const inserted = await tx
    .insert(accountClosureEvents)
    .values({
      requestId: input.requestId,
      eventType: input.eventType,
      ...(input.taskKind ? { taskKind: input.taskKind } : {}),
      actorClerkUserId: input.actorClerkUserId,
      operationKey: input.operationKey,
      operationDigest,
      ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
      occurredAt: input.occurredAt,
      createdAt: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: accountClosureEvents.id });
  if (inserted.length === 1) return;

  const [existing] = await tx
    .select({ operationDigest: accountClosureEvents.operationDigest })
    .from(accountClosureEvents)
    .where(
      and(
        eq(accountClosureEvents.requestId, input.requestId),
        eq(accountClosureEvents.operationKey, input.operationKey),
      ),
    )
    .limit(1);
  if (!existing || existing.operationDigest !== operationDigest) {
    throw new AccountClosureError("account_closure_conflict");
  }
}

function dueDate(verifiedAt: Date): Date {
  return new Date(verifiedAt.getTime() + 30 * 24 * 60 * 60 * 1_000);
}

function terminalTask(status: string): boolean {
  return status === "succeeded" || status === "not_applicable";
}

export function createAccountClosureStore(db: Db): AccountClosureStore {
  return {
    async openRequest(input) {
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const receivedAt = await transactionNow(tx);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`account-closure:${input.clerkUserId}`}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(accountClosureRequests)
          .where(eq(accountClosureRequests.clerkUserId, input.clerkUserId))
          .limit(1);
        if (existing) {
          if (existing.requesterEmailHash !== input.requesterEmailHash) {
            throw new AccountClosureError("account_closure_conflict");
          }
          return requestRecord(existing);
        }

        const [created] = await tx
          .insert(accountClosureRequests)
          .values({
            clerkUserId: input.clerkUserId,
            requesterEmailHash: input.requesterEmailHash,
            receivedAt,
            createdAt: receivedAt,
            updatedAt: receivedAt,
          })
          .returning();
        if (!created) throw new AccountClosureError("account_closure_conflict");
        await appendEvent(tx, {
          requestId: created.id,
          eventType: "requested",
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          occurredAt: receivedAt,
        });
        return requestRecord(created);
      });
    },

    async verifyAndBeginClosure(input) {
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const current = await lockedRequest(tx, input.requestId);
        if (current.closureStartedAt !== null) return requestRecord(current);
        const [producer] = await tx
          .select({ id: producers.id, closedAt: producers.closedAt })
          .from(producers)
          .where(eq(producers.clerkUserId, current.clerkUserId))
          .limit(1)
          .for("update");
        if (producer?.closedAt) {
          throw new AccountClosureError("account_closure_conflict");
        }

        // Capability issuance uses the same Producer row lock. Take the wall
        // clock only after that lock is acquired so the 15-minute expiry wait
        // starts after every pre-closure capability has actually been issued.
        const verifiedAt = await databaseWallClockNow(tx);
        if (current.status !== "requested" || verifiedAt < current.receivedAt) {
          throw new AccountClosureError("account_closure_conflict");
        }

        const dueAt = dueDate(verifiedAt);
        const [updated] = await tx
          .update(accountClosureRequests)
          .set({
            status: "processing",
            identityVerifiedAt: verifiedAt,
            closureStartedAt: verifiedAt,
            dueAt,
            verifiedByClerkUserId: input.actorClerkUserId,
            updatedAt: verifiedAt,
          })
          .where(eq(accountClosureRequests.id, current.id))
          .returning();
        if (!updated) throw new AccountClosureError("account_closure_conflict");

        if (producer) {
          const [closed] = await tx
            .update(producers)
            .set({ closedAt: verifiedAt, updatedAt: verifiedAt })
            .where(and(eq(producers.id, producer.id), isNull(producers.closedAt)))
            .returning({ id: producers.id });
          if (!closed) throw new AccountClosureError("account_closure_conflict");
        }
        await tx
          .insert(accountClosureTasks)
          .values(
            ACCOUNT_CLOSURE_TASKS.map((kind) => ({
              requestId: current.id,
              kind,
              updatedAt: verifiedAt,
            })),
          )
          .onConflictDoNothing();

        await appendEvent(tx, {
          requestId: current.id,
          eventType: "identity_verified",
          actorClerkUserId: input.actorClerkUserId,
          operationKey: `${input.operationKey}:verified`,
          occurredAt: verifiedAt,
        });
        await appendEvent(tx, {
          requestId: current.id,
          eventType: "closure_started",
          actorClerkUserId: input.actorClerkUserId,
          operationKey: `${input.operationKey}:closed`,
          occurredAt: verifiedAt,
        });
        return requestRecord(updated);
      });
    },

    async getRequest(requestId) {
      const [row] = await db
        .select()
        .from(accountClosureRequests)
        .where(eq(accountClosureRequests.id, requestId))
        .limit(1);
      return row ? requestRecord(row) : null;
    },

    async getTasks(requestId) {
      return db
        .select({ kind: accountClosureTasks.kind, status: accountClosureTasks.status })
        .from(accountClosureTasks)
        .where(eq(accountClosureTasks.requestId, requestId));
    },

    async claimTask(input) {
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const attemptedAt = await transactionNow(tx);
        const request = await lockedRequest(tx, input.requestId);
        if (request.closureStartedAt === null) {
          throw new AccountClosureError("account_closure_not_verified");
        }
        if (isAccountClosureLegalHoldActive(request)) {
          throw new AccountClosureError("account_closure_legal_hold");
        }
        const [task] = await tx
          .select()
          .from(accountClosureTasks)
          .where(
            and(
              eq(accountClosureTasks.requestId, input.requestId),
              eq(accountClosureTasks.kind, input.kind),
            ),
          )
          .limit(1)
          .for("update");
        if (!task) throw new AccountClosureError("account_closure_task_state");
        if (terminalTask(task.status)) return null;
        if (task.status === "running") return null;

        const attempt = task.attemptCount + 1;
        const [claimed] = await tx
          .update(accountClosureTasks)
          .set({
            status: "running",
            attemptCount: attempt,
            lastErrorCode: null,
            evidenceRef: null,
            startedAt: attemptedAt,
            completedAt: null,
            updatedAt: attemptedAt,
          })
          .where(
            and(
              eq(accountClosureTasks.requestId, input.requestId),
              eq(accountClosureTasks.kind, input.kind),
            ),
          )
          .returning({ kind: accountClosureTasks.kind });
        if (!claimed) throw new AccountClosureError("account_closure_task_state");
        await tx
          .update(accountClosureRequests)
          .set({ status: "processing", updatedAt: attemptedAt })
          .where(eq(accountClosureRequests.id, input.requestId));
        await appendEvent(tx, {
          requestId: input.requestId,
          eventType: "task_started",
          taskKind: input.kind,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          occurredAt: attemptedAt,
        });
        return {
          attempt,
          kind: input.kind,
          request: requestRecord({
            ...request,
            status: "processing",
            updatedAt: attemptedAt,
          }),
        } satisfies ClaimedAccountClosureTask;
      });
    },

    async succeedTask(input) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const completedAt = await transactionNow(tx);
        const request = await lockedRequest(tx, input.claim.request.id);
        if (isAccountClosureLegalHoldActive(request)) {
          throw new AccountClosureError("account_closure_legal_hold");
        }
        const completed = await tx
          .update(accountClosureTasks)
          .set({
            status: "succeeded",
            lastErrorCode: null,
            evidenceRef: input.evidenceRef,
            completedAt,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(accountClosureTasks.requestId, input.claim.request.id),
              eq(accountClosureTasks.kind, input.claim.kind),
              eq(accountClosureTasks.status, "running"),
              eq(accountClosureTasks.attemptCount, input.claim.attempt),
            ),
          )
          .returning({ kind: accountClosureTasks.kind });
        if (completed.length !== 1) {
          throw new AccountClosureError("account_closure_task_state");
        }
        await appendEvent(tx, {
          requestId: input.claim.request.id,
          eventType: "task_succeeded",
          taskKind: input.claim.kind,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          evidenceRef: input.evidenceRef,
          occurredAt: completedAt,
        });
        if (input.claim.kind === "clerk_account_delete") {
          await tx
            .update(accountClosureRequests)
            .set({
              status: "processing",
              accessRevokedAt: completedAt,
              updatedAt: completedAt,
            })
            .where(eq(accountClosureRequests.id, input.claim.request.id));
          await appendEvent(tx, {
            requestId: input.claim.request.id,
            eventType: "access_revoked",
            actorClerkUserId: input.actorClerkUserId,
            operationKey: `${input.operationKey}:access-revoked`,
            evidenceRef: input.evidenceRef,
            occurredAt: completedAt,
          });
        }
      });
    },

    async markTaskNotApplicable(input) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const completedAt = await transactionNow(tx);
        const request = await lockedRequest(tx, input.claim.request.id);
        if (isAccountClosureLegalHoldActive(request)) {
          throw new AccountClosureError("account_closure_legal_hold");
        }
        const completed = await tx
          .update(accountClosureTasks)
          .set({
            status: "not_applicable",
            lastErrorCode: null,
            evidenceRef: input.evidenceRef,
            completedAt,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(accountClosureTasks.requestId, input.claim.request.id),
              eq(accountClosureTasks.kind, input.claim.kind),
              eq(accountClosureTasks.status, "running"),
              eq(accountClosureTasks.attemptCount, input.claim.attempt),
            ),
          )
          .returning({ kind: accountClosureTasks.kind });
        if (completed.length !== 1) {
          throw new AccountClosureError("account_closure_task_state");
        }
        await appendEvent(tx, {
          requestId: input.claim.request.id,
          eventType: "task_not_applicable",
          taskKind: input.claim.kind,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          evidenceRef: input.evidenceRef,
          occurredAt: completedAt,
        });
      });
    },

    async blockTask(input) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const blockedAt = await transactionNow(tx);
        const blocked = await tx
          .update(accountClosureTasks)
          .set({
            status: "blocked",
            lastErrorCode: input.errorCode,
            evidenceRef: null,
            completedAt: null,
            updatedAt: blockedAt,
          })
          .where(
            and(
              eq(accountClosureTasks.requestId, input.claim.request.id),
              eq(accountClosureTasks.kind, input.claim.kind),
              eq(accountClosureTasks.status, "running"),
              eq(accountClosureTasks.attemptCount, input.claim.attempt),
            ),
          )
          .returning({ kind: accountClosureTasks.kind });
        if (blocked.length !== 1) {
          throw new AccountClosureError("account_closure_task_state");
        }
        await tx
          .update(accountClosureRequests)
          .set({ status: "blocked", updatedAt: blockedAt })
          .where(eq(accountClosureRequests.id, input.claim.request.id));
        await appendEvent(tx, {
          requestId: input.claim.request.id,
          eventType: "task_blocked",
          taskKind: input.claim.kind,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          evidenceRef: `error:${input.errorCode}`,
          occurredAt: blockedAt,
        });
      });
    },

    async recoverStaleTask(input) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const recoveredAt = await transactionNow(tx);
        const request = await lockedRequest(tx, input.requestId);
        if (request.closureStartedAt === null) {
          throw new AccountClosureError("account_closure_not_verified");
        }
        if (isAccountClosureLegalHoldActive(request)) {
          throw new AccountClosureError("account_closure_legal_hold");
        }
        const [task] = await tx
          .select()
          .from(accountClosureTasks)
          .where(
            and(
              eq(accountClosureTasks.requestId, input.requestId),
              eq(accountClosureTasks.kind, input.kind),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !task ||
          task.status !== "running" ||
          !task.startedAt ||
          isAccountClosureRunningTaskLeaseActive(task.startedAt, recoveredAt)
        ) {
          throw new AccountClosureError("account_closure_task_state");
        }

        const [recovered] = await tx
          .update(accountClosureTasks)
          .set({
            status: "blocked",
            lastErrorCode: "stale_claim_recovered",
            evidenceRef: null,
            completedAt: null,
            updatedAt: recoveredAt,
          })
          .where(
            and(
              eq(accountClosureTasks.requestId, input.requestId),
              eq(accountClosureTasks.kind, input.kind),
              eq(accountClosureTasks.status, "running"),
              eq(accountClosureTasks.attemptCount, task.attemptCount),
            ),
          )
          .returning({ kind: accountClosureTasks.kind });
        if (!recovered) {
          throw new AccountClosureError("account_closure_task_state");
        }
        await tx
          .update(accountClosureRequests)
          .set({ status: "blocked", updatedAt: recoveredAt })
          .where(eq(accountClosureRequests.id, input.requestId));
        await appendEvent(tx, {
          requestId: input.requestId,
          eventType: "task_blocked",
          taskKind: input.kind,
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          evidenceRef: input.evidenceRef,
          occurredAt: recoveredAt,
        });
      });
    },

    async resolveProducerId(clerkUserId) {
      const [producer] = await db
        .select({ id: producers.id })
        .from(producers)
        .where(and(eq(producers.clerkUserId, clerkUserId), isNotNull(producers.closedAt)))
        .limit(1);
      return producer?.id ?? null;
    },

    async hasGoogleCalendarConnection(producerId) {
      const [connection] = await db
        .select({ id: googleCalendarConnections.id })
        .from(googleCalendarConnections)
        .where(
          and(
            eq(googleCalendarConnections.producerId, producerId),
            isNull(googleCalendarConnections.disconnectedAt),
          ),
        )
        .limit(1);
      return connection !== undefined;
    },

    async deleteDeviceAndArtistPreferences(clerkUserId) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.clerkUserId, clerkUserId));
        await tx.delete(artistProfiles).where(eq(artistProfiles.clerkUserId, clerkUserId));
        await tx
          .delete(artistNotifications)
          .where(eq(artistNotifications.recipientClerkUserId, clerkUserId));
      });
    },

    async revokePublicAndCapabilityLinks(producerId) {
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const revokedAt = await transactionNow(tx);
        const [producer] = await tx
          .select({ id: producers.id, closedAt: producers.closedAt })
          .from(producers)
          .where(and(eq(producers.id, producerId), isNotNull(producers.closedAt)))
          .limit(1)
          .for("update");
        if (!producer?.closedAt) throw new AccountClosureError("account_closure_task_state");

        await tx
          .update(songPublicLinks)
          .set({ disabledAt: revokedAt, updatedAt: revokedAt })
          .where(
            and(eq(songPublicLinks.producerId, producerId), isNull(songPublicLinks.disabledAt)),
          );

        const producerProjectIds = tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.producerId, producerId));
        await tx
          .update(projectTracks)
          .set({ portfolioPublishedAt: null })
          .where(
            and(
              inArray(projectTracks.projectId, producerProjectIds),
              isNotNull(projectTracks.portfolioPublishedAt),
            ),
          );

        return localCapabilitiesAreRevoked(tx, {
          producerId,
          closedAt: producer.closedAt,
          checkedAt: revokedAt,
        });
      });
    },

    async applyLegalHold(input) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const appliedAt = await transactionNow(tx);
        const request = await lockedRequest(tx, input.requestId);
        if (request.closureStartedAt === null || request.status === "completed") {
          throw new AccountClosureError("account_closure_not_verified");
        }
        if (isAccountClosureLegalHoldActive(request)) return;
        await tx
          .update(accountClosureRequests)
          .set({
            status: "blocked",
            legalHoldAt: appliedAt,
            legalHoldReasonCode: input.reasonCode,
            legalHoldByClerkUserId: input.actorClerkUserId,
            legalHoldReleasedAt: null,
            updatedAt: appliedAt,
          })
          .where(eq(accountClosureRequests.id, input.requestId));
        await appendEvent(tx, {
          requestId: input.requestId,
          eventType: "legal_hold_applied",
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          evidenceRef: `reason:${input.reasonCode}`,
          occurredAt: appliedAt,
        });
      });
    },

    async releaseLegalHold(input) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const releasedAt = await transactionNow(tx);
        const request = await lockedRequest(tx, input.requestId);
        if (!isAccountClosureLegalHoldActive(request)) return;
        if (releasedAt < (request.legalHoldAt as Date)) {
          throw new AccountClosureError("account_closure_conflict");
        }
        await tx
          .update(accountClosureRequests)
          .set({
            status: "processing",
            legalHoldReleasedAt: releasedAt,
            updatedAt: releasedAt,
          })
          .where(eq(accountClosureRequests.id, input.requestId));
        await appendEvent(tx, {
          requestId: input.requestId,
          eventType: "legal_hold_released",
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          occurredAt: releasedAt,
        });
      });
    },

    async completeIfReady(input) {
      return db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as TransactionDb;
        const completedAt = await transactionNow(tx);
        const request = await lockedRequest(tx, input.requestId);
        if (request.status === "completed") return true;
        if (
          request.closureStartedAt === null ||
          request.accessRevokedAt === null ||
          isAccountClosureLegalHoldActive(request)
        ) {
          return false;
        }
        const tasks = await tx
          .select({ kind: accountClosureTasks.kind, status: accountClosureTasks.status })
          .from(accountClosureTasks)
          .where(eq(accountClosureTasks.requestId, input.requestId));
        const ready =
          tasks.length === ACCOUNT_CLOSURE_TASKS.length &&
          tasks.every((task) => terminalTask(task.status));
        if (!ready) return false;

        const [producer] = await tx
          .select({ id: producers.id, closedAt: producers.closedAt })
          .from(producers)
          .where(eq(producers.clerkUserId, request.clerkUserId))
          .limit(1)
          .for("update");
        if (producer) {
          if (
            !producer.closedAt ||
            !(await localCapabilitiesAreRevoked(tx, {
              producerId: producer.id,
              closedAt: producer.closedAt,
              checkedAt: completedAt,
            }))
          ) {
            return false;
          }
        }

        await tx
          .update(accountClosureRequests)
          .set({
            status: "completed",
            completedAt,
            updatedAt: completedAt,
          })
          .where(eq(accountClosureRequests.id, input.requestId));
        await appendEvent(tx, {
          requestId: input.requestId,
          eventType: "completed",
          actorClerkUserId: input.actorClerkUserId,
          operationKey: input.operationKey,
          occurredAt: completedAt,
        });
        return true;
      });
    },
  };
}
