import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  bookingCalendarLinks,
  bookings,
  calendarSyncJobs,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  notInArray,
  producers,
  projects,
  sql,
  googleCalendarConnections,
  googleCalendarOAuthStates,
  googleCalendarSelections,
  googleCalendarWatches,
  type Db,
  type GoogleCalendarConnection,
  type GoogleCalendarOAuthState,
  type GoogleCalendarSelection,
  type GoogleCalendarSyncJobPayloadSnapshot,
  type GoogleCalendarWatch,
} from "@skitza/db";

import type { EncryptedGoogleCalendarValue } from "./crypto";
import type {
  GoogleCalendarCandidateRecord,
  GoogleCalendarConnectionRecord,
  GoogleCalendarRepository,
  GoogleCalendarStoredWatchRecord,
  GoogleCalendarStoredOAuthState,
  GoogleCalendarWatchTarget,
} from "./repository";

function afterTimestamp(requested: Date, existing: Date): Date {
  return new Date(Math.max(requested.getTime(), existing.getTime() + 1));
}

function advancedTimestamp(column: unknown, requested: Date) {
  return sql<Date>`greatest(${requested}, ${column} + interval '1 millisecond')`;
}

function encryptedValue(
  input: Readonly<{
    ciphertext: string | null;
    iv: string | null;
    authTag: string | null;
    keyVersion: number | null;
  }>,
): EncryptedGoogleCalendarValue | null {
  if (
    input.ciphertext === null ||
    input.iv === null ||
    input.authTag === null ||
    input.keyVersion === null
  ) {
    return null;
  }
  return {
    version: 1,
    ciphertext: input.ciphertext,
    iv: input.iv,
    authTag: input.authTag,
    keyVersion: input.keyVersion,
  };
}

function connectionRecord(row: GoogleCalendarConnection): GoogleCalendarConnectionRecord {
  return {
    id: row.id,
    producerId: row.producerId,
    googleSubject: row.googleSubject,
    googleAccountEmail: row.googleAccountEmail,
    accountVersion: row.accountVersion,
    status: row.status,
    grantedScopes: row.grantedScopes,
    accessToken: encryptedValue({
      ciphertext: row.accessTokenCiphertext,
      iv: row.accessTokenIv,
      authTag: row.accessTokenAuthTag,
      keyVersion: row.accessTokenKeyVersion,
    }),
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshToken: encryptedValue({
      ciphertext: row.refreshTokenCiphertext,
      iv: row.refreshTokenIv,
      authTag: row.refreshTokenAuthTag,
      keyVersion: row.refreshTokenKeyVersion,
    }),
    lastAuthorizedAt: row.lastAuthorizedAt,
    reconnectRequiredAt: row.reconnectRequiredAt,
    disconnectedAt: row.disconnectedAt,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function selectionRecord(row: GoogleCalendarSelection): GoogleCalendarCandidateRecord {
  const providerCalendarId = encryptedValue({
    ciphertext: row.providerCalendarIdCiphertext,
    iv: row.providerCalendarIdIv,
    authTag: row.providerCalendarIdAuthTag,
    keyVersion: row.providerCalendarIdKeyVersion,
  });
  if (!providerCalendarId) {
    throw new Error("Invalid protected Google Calendar row");
  }
  return {
    id: row.id,
    connectionId: row.connectionId,
    producerId: row.producerId,
    accountVersion: row.accountVersion,
    providerCalendarId,
    providerCalendarIdFingerprint: row.providerCalendarIdFingerprint,
    displayName: row.displayName,
    timezone: row.timezone,
    accessRole: row.accessRole,
    isPrimary: row.isPrimary,
    isDestination: row.isDestination,
    blocksAvailability: row.blocksAvailability,
  };
}

function oauthStateRecord(row: GoogleCalendarOAuthState): GoogleCalendarStoredOAuthState {
  return {
    id: row.id,
    tokenDigest: row.stateTokenDigest,
    producerId: row.producerId,
    intent: row.intent,
    connectionId: row.connectionId,
    expectedAccountVersion: row.expectedAccountVersion,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

function watchRecord(row: GoogleCalendarWatch): GoogleCalendarStoredWatchRecord {
  const destinationCalendarId = encryptedValue({
    ciphertext: row.destinationCalendarIdCiphertext,
    iv: row.destinationCalendarIdIv,
    authTag: row.destinationCalendarIdAuthTag,
    keyVersion: row.destinationCalendarIdKeyVersion,
  });
  if (!destinationCalendarId) {
    throw new Error("Invalid protected Google Calendar watch row");
  }
  return {
    id: row.id,
    producerId: row.producerId,
    connectionId: row.connectionId,
    accountVersion: row.accountVersion,
    destinationSelectionId: row.destinationSelectionId,
    destinationCalendarId,
    destinationCalendarIdFingerprint: row.destinationCalendarIdFingerprint,
    renewalOfWatchId: row.renewalOfWatchId,
    providerChannelId: row.providerChannelId,
    providerResourceId: row.providerResourceId,
    channelTokenDigest: row.channelTokenDigest,
    state: row.state,
    expiresAt: row.expiresAt,
    activatedAt: row.activatedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

function watchTargetRecord(row: {
  producerId: string;
  connectionId: string;
  accountVersion: number;
  destinationSelectionId: string;
  destinationCalendarIdCiphertext: string;
  destinationCalendarIdIv: string;
  destinationCalendarIdAuthTag: string;
  destinationCalendarIdKeyVersion: number;
  destinationCalendarIdFingerprint: string;
}): GoogleCalendarWatchTarget {
  const destinationCalendarId = encryptedValue({
    ciphertext: row.destinationCalendarIdCiphertext,
    iv: row.destinationCalendarIdIv,
    authTag: row.destinationCalendarIdAuthTag,
    keyVersion: row.destinationCalendarIdKeyVersion,
  });
  if (!destinationCalendarId) {
    throw new Error("Invalid protected Google Calendar watch target");
  }
  return {
    producerId: row.producerId,
    connectionId: row.connectionId,
    accountVersion: row.accountVersion,
    destinationSelectionId: row.destinationSelectionId,
    destinationCalendarId,
    destinationCalendarIdFingerprint: row.destinationCalendarIdFingerprint,
  };
}

function hasValidSelection(rows: readonly GoogleCalendarSelection[]): boolean {
  return (
    rows.filter(
      (row) => row.isDestination && (row.accessRole === "writer" || row.accessRole === "owner"),
    ).length === 1 && rows.some((row) => row.blocksAvailability)
  );
}

async function lockedConnection(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  producerId: string,
): Promise<GoogleCalendarConnection | null> {
  const [row] = await tx
    .select()
    .from(googleCalendarConnections)
    .where(eq(googleCalendarConnections.producerId, producerId))
    .limit(1)
    .for("update");
  return row ?? null;
}

async function lockedProducerAuthorizationState(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  producerId: string,
): Promise<Readonly<{ id: string; closedAt: Date | null }> | null> {
  const [row] = await tx
    .select({ id: producers.id, closedAt: producers.closedAt })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function dismissGoogleCalendarSyncWarning(
  db: Db,
  command: Readonly<{
    producerId: string;
    bookingId: string;
    syncState: "not_synced" | "missing" | "conflict";
    syncStateChangedAt: Date;
    dismissedAt: Date;
  }>,
): Promise<boolean> {
  const attentionVisible = sql<boolean>`(
    ${bookingCalendarLinks.attentionDismissedAt} IS NULL
    OR ${bookingCalendarLinks.attentionDismissedAt} < ${bookingCalendarLinks.syncStateChangedAt}
  )`;
  const dismissedAt = sql<Date>`greatest(
    ${command.dismissedAt}::timestamptz,
    ${bookingCalendarLinks.syncStateChangedAt},
    ${bookingCalendarLinks.updatedAt} + interval '1 millisecond'
  )`;
  const rows = await db
    .update(bookingCalendarLinks)
    .set({
      attentionDismissedAt: dismissedAt,
      updatedAt: dismissedAt,
    })
    .where(
      and(
        eq(bookingCalendarLinks.producerId, command.producerId),
        eq(bookingCalendarLinks.currentBookingId, command.bookingId),
        eq(bookingCalendarLinks.syncState, command.syncState),
        sql`date_trunc('milliseconds', ${bookingCalendarLinks.syncStateChangedAt}) =
          date_trunc('milliseconds', ${command.syncStateChangedAt}::timestamptz)`,
        attentionVisible,
      ),
    )
    .returning({ id: bookingCalendarLinks.id });
  return rows.length === 1;
}

export function createGoogleCalendarRepository(db: Db): GoogleCalendarRepository {
  return {
    async getConnection(producerId) {
      const [row] = await db
        .select()
        .from(googleCalendarConnections)
        .where(eq(googleCalendarConnections.producerId, producerId))
        .limit(1);
      return row ? connectionRecord(row) : null;
    },

    async createOAuthState(state) {
      await db.insert(googleCalendarOAuthStates).values({
        id: state.id,
        stateTokenDigest: state.tokenDigest,
        producerId: state.producerId,
        intent: state.intent,
        connectionId: state.connectionId,
        expectedAccountVersion: state.expectedAccountVersion,
        expiresAt: state.expiresAt,
        createdAt: state.createdAt,
      });
    },

    async getOAuthState({ tokenDigest, now }) {
      const [row] = await db
        .select()
        .from(googleCalendarOAuthStates)
        .where(
          and(
            eq(googleCalendarOAuthStates.stateTokenDigest, tokenDigest),
            isNull(googleCalendarOAuthStates.consumedAt),
            gt(googleCalendarOAuthStates.expiresAt, now),
          ),
        )
        .limit(1);
      return row ? oauthStateRecord(row) : null;
    },

    async consumeOAuthState({ producerId, tokenDigest, consumedAt }) {
      const [row] = await db
        .update(googleCalendarOAuthStates)
        .set({ consumedAt })
        .where(
          and(
            eq(googleCalendarOAuthStates.producerId, producerId),
            eq(googleCalendarOAuthStates.stateTokenDigest, tokenDigest),
            isNull(googleCalendarOAuthStates.consumedAt),
            gt(googleCalendarOAuthStates.expiresAt, consumedAt),
          ),
        )
        .returning();
      return row ? oauthStateRecord(row) : null;
    },

    async commitAuthorization(command) {
      return db.transaction(async (tx) => {
        const producer = await lockedProducerAuthorizationState(tx, command.producerId);
        if (!producer || producer.closedAt !== null) {
          return { outcome: "stale" } as const;
        }
        const existing = await lockedConnection(tx, command.producerId);
        if (!existing) {
          if (
            command.intent !== "connect" ||
            command.expectedConnectionId !== null ||
            command.expectedAccountVersion !== null ||
            command.targetAccountVersion !== 1 ||
            !command.refreshToken
          ) {
            return {
              outcome: command.refreshToken ? "stale" : "missing_refresh",
            } as const;
          }
          const [inserted] = await tx
            .insert(googleCalendarConnections)
            .values({
              id: command.targetConnectionId,
              producerId: command.producerId,
              googleSubject: command.identity.googleSubject,
              googleAccountEmail: command.identity.googleAccountEmail,
              accountVersion: 1,
              status: "needs_selection",
              grantedScopes: [...command.grantedScopes],
              accessTokenCiphertext: command.accessToken.ciphertext,
              accessTokenIv: command.accessToken.iv,
              accessTokenAuthTag: command.accessToken.authTag,
              accessTokenKeyVersion: command.accessToken.keyVersion,
              accessTokenExpiresAt: command.accessTokenExpiresAt,
              refreshTokenCiphertext: command.refreshToken.ciphertext,
              refreshTokenIv: command.refreshToken.iv,
              refreshTokenAuthTag: command.refreshToken.authTag,
              refreshTokenKeyVersion: command.refreshToken.keyVersion,
              refreshTokenUpdatedAt: command.authorizedAt,
              lastAuthorizedAt: command.authorizedAt,
              createdAt: command.authorizedAt,
              updatedAt: command.authorizedAt,
            })
            .onConflictDoNothing({ target: googleCalendarConnections.producerId })
            .returning();
          return inserted
            ? ({ outcome: "stored", connection: connectionRecord(inserted) } as const)
            : ({ outcome: "stale" } as const);
        }

        if (
          command.intent === "connect" ||
          existing.id !== command.expectedConnectionId ||
          existing.accountVersion !== command.expectedAccountVersion ||
          existing.id !== command.targetConnectionId
        ) {
          return { outcome: "stale" } as const;
        }
        if (
          existing.status === "disconnected" &&
          (!existing.disconnectedAt ||
            command.oauthStateCreatedAt.getTime() <= existing.disconnectedAt.getTime())
        ) {
          return { outcome: "stale" } as const;
        }
        const changesSubject = existing.googleSubject !== command.identity.googleSubject;
        if (changesSubject && command.intent !== "switch_account") {
          return { outcome: "wrong_account" } as const;
        }
        const requiredVersion = changesSubject
          ? existing.accountVersion + 1
          : existing.accountVersion;
        if (command.targetAccountVersion !== requiredVersion) {
          return { outcome: "stale" } as const;
        }
        const refreshToken =
          command.refreshToken ??
          encryptedValue({
            ciphertext: existing.refreshTokenCiphertext,
            iv: existing.refreshTokenIv,
            authTag: existing.refreshTokenAuthTag,
            keyVersion: existing.refreshTokenKeyVersion,
          });
        if (!refreshToken || (changesSubject && !command.refreshToken)) {
          return { outcome: "missing_refresh" } as const;
        }

        const authorizedAt = afterTimestamp(command.authorizedAt, existing.lastAuthorizedAt);
        const updatedAt = afterTimestamp(authorizedAt, existing.updatedAt);
        const refreshTokenUpdatedAt = command.refreshToken
          ? afterTimestamp(authorizedAt, existing.refreshTokenUpdatedAt ?? existing.createdAt)
          : existing.refreshTokenUpdatedAt;
        if (changesSubject) {
          await tx
            .update(googleCalendarWatches)
            .set({
              state: "retired",
              endedAt: authorizedAt,
              lastErrorCode: null,
              updatedAt: advancedTimestamp(googleCalendarWatches.updatedAt, authorizedAt),
            })
            .where(
              and(
                eq(googleCalendarWatches.connectionId, existing.id),
                eq(googleCalendarWatches.producerId, command.producerId),
                eq(googleCalendarWatches.accountVersion, existing.accountVersion),
                inArray(googleCalendarWatches.state, ["renewing", "active"]),
              ),
            );
          await tx
            .delete(googleCalendarSelections)
            .where(
              and(
                eq(googleCalendarSelections.connectionId, existing.id),
                eq(googleCalendarSelections.producerId, command.producerId),
                eq(googleCalendarSelections.accountVersion, existing.accountVersion),
              ),
            );
        }
        const currentSelections = changesSubject
          ? []
          : await tx
              .select()
              .from(googleCalendarSelections)
              .where(
                and(
                  eq(googleCalendarSelections.connectionId, existing.id),
                  eq(googleCalendarSelections.producerId, command.producerId),
                  eq(googleCalendarSelections.accountVersion, existing.accountVersion),
                ),
              );
        const status = hasValidSelection(currentSelections) ? "connected" : "needs_selection";
        const [updated] = await tx
          .update(googleCalendarConnections)
          .set({
            googleSubject: command.identity.googleSubject,
            googleAccountEmail: command.identity.googleAccountEmail,
            accountVersion: command.targetAccountVersion,
            status,
            grantedScopes: [...command.grantedScopes],
            accessTokenCiphertext: command.accessToken.ciphertext,
            accessTokenIv: command.accessToken.iv,
            accessTokenAuthTag: command.accessToken.authTag,
            accessTokenKeyVersion: command.accessToken.keyVersion,
            accessTokenExpiresAt: command.accessTokenExpiresAt,
            refreshTokenCiphertext: refreshToken.ciphertext,
            refreshTokenIv: refreshToken.iv,
            refreshTokenAuthTag: refreshToken.authTag,
            refreshTokenKeyVersion: refreshToken.keyVersion,
            refreshTokenUpdatedAt,
            lastAuthorizedAt: authorizedAt,
            reconnectRequiredAt: null,
            disconnectedAt: null,
            lastErrorCode: null,
            updatedAt,
          })
          .where(
            and(
              eq(googleCalendarConnections.id, existing.id),
              eq(googleCalendarConnections.producerId, command.producerId),
              eq(googleCalendarConnections.accountVersion, existing.accountVersion),
            ),
          )
          .returning();
        return updated
          ? ({ outcome: "stored", connection: connectionRecord(updated) } as const)
          : ({ outcome: "stale" } as const);
      });
    },

    async storeRefreshedAccessToken(command) {
      const [updated] = await db
        .update(googleCalendarConnections)
        .set({
          accessTokenCiphertext: command.accessToken.ciphertext,
          accessTokenIv: command.accessToken.iv,
          accessTokenAuthTag: command.accessToken.authTag,
          accessTokenKeyVersion: command.accessToken.keyVersion,
          accessTokenExpiresAt: command.accessTokenExpiresAt,
          ...(command.grantedScopes ? { grantedScopes: [...command.grantedScopes] } : {}),
          lastErrorCode: null,
          updatedAt: advancedTimestamp(googleCalendarConnections.updatedAt, command.refreshedAt),
        })
        .where(
          and(
            eq(googleCalendarConnections.id, command.connectionId),
            eq(googleCalendarConnections.producerId, command.producerId),
            eq(googleCalendarConnections.googleSubject, command.googleSubject),
            eq(googleCalendarConnections.accountVersion, command.accountVersion),
            notInArray(googleCalendarConnections.status, ["reconnect_required", "disconnected"]),
          ),
        )
        .returning({ id: googleCalendarConnections.id });
      return updated !== undefined;
    },

    async markReconnectRequired(command) {
      await db
        .update(googleCalendarConnections)
        .set({
          status: "reconnect_required",
          reconnectRequiredAt: advancedTimestamp(
            googleCalendarConnections.updatedAt,
            command.occurredAt,
          ),
          disconnectedAt: null,
          lastErrorCode: command.errorCode,
          updatedAt: advancedTimestamp(googleCalendarConnections.updatedAt, command.occurredAt),
        })
        .where(
          and(
            eq(googleCalendarConnections.id, command.connectionId),
            eq(googleCalendarConnections.producerId, command.producerId),
            eq(googleCalendarConnections.accountVersion, command.accountVersion),
            notInArray(googleCalendarConnections.status, ["disconnected"]),
          ),
        );
    },

    async replaceCalendarCandidates(command) {
      return db.transaction(async (tx) => {
        const connection = await lockedConnection(tx, command.producerId);
        if (
          !connection ||
          connection.id !== command.connectionId ||
          connection.accountVersion !== command.accountVersion ||
          connection.status === "disconnected" ||
          connection.status === "reconnect_required"
        ) {
          return null;
        }
        const existingRows = await tx
          .select()
          .from(googleCalendarSelections)
          .where(
            and(
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
            ),
          )
          .for("update");
        const existingById = new Map(existingRows.map((row) => [row.id, row]));
        const candidateIds = command.candidates.map((candidate) => candidate.id);
        await tx
          .delete(googleCalendarSelections)
          .where(
            and(
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
              candidateIds.length > 0
                ? notInArray(googleCalendarSelections.id, candidateIds)
                : undefined,
            ),
          );

        for (const candidate of command.candidates) {
          const existing = existingById.get(candidate.id);
          const keepsDestination =
            existing?.isDestination === true &&
            (candidate.accessRole === "writer" || candidate.accessRole === "owner");
          const values = {
            providerCalendarIdCiphertext: candidate.providerCalendarId.ciphertext,
            providerCalendarIdIv: candidate.providerCalendarId.iv,
            providerCalendarIdAuthTag: candidate.providerCalendarId.authTag,
            providerCalendarIdKeyVersion: candidate.providerCalendarId.keyVersion,
            displayName: candidate.displayName,
            timezone: candidate.timezone,
            accessRole: candidate.accessRole,
            isPrimary: candidate.isPrimary,
            isDestination: keepsDestination,
            blocksAvailability: existing?.blocksAvailability ?? false,
          } as const;
          if (existing) {
            await tx
              .update(googleCalendarSelections)
              .set({
                ...values,
                updatedAt: afterTimestamp(command.refreshedAt, existing.updatedAt),
              })
              .where(
                and(
                  eq(googleCalendarSelections.id, existing.id),
                  eq(googleCalendarSelections.connectionId, command.connectionId),
                  eq(googleCalendarSelections.producerId, command.producerId),
                  eq(googleCalendarSelections.accountVersion, command.accountVersion),
                ),
              );
          } else {
            await tx.insert(googleCalendarSelections).values({
              id: candidate.id,
              connectionId: candidate.connectionId,
              producerId: candidate.producerId,
              accountVersion: candidate.accountVersion,
              providerCalendarIdFingerprint: candidate.providerCalendarIdFingerprint,
              ...values,
              createdAt: command.refreshedAt,
              updatedAt: command.refreshedAt,
            });
          }
        }
        const rows = await tx
          .select()
          .from(googleCalendarSelections)
          .where(
            and(
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
            ),
          )
          .orderBy(
            desc(googleCalendarSelections.isPrimary),
            asc(googleCalendarSelections.displayName),
            asc(googleCalendarSelections.id),
          );
        if (connection.status === "connected" && !hasValidSelection(rows)) {
          await tx
            .update(googleCalendarConnections)
            .set({
              status: "needs_selection",
              updatedAt: advancedTimestamp(
                googleCalendarConnections.updatedAt,
                command.refreshedAt,
              ),
            })
            .where(
              and(
                eq(googleCalendarConnections.id, command.connectionId),
                eq(googleCalendarConnections.producerId, command.producerId),
                eq(googleCalendarConnections.accountVersion, command.accountVersion),
              ),
            );
        }
        return rows.map(selectionRecord);
      });
    },

    async listCalendarCandidates(command) {
      const rows = await db
        .select()
        .from(googleCalendarSelections)
        .where(
          and(
            eq(googleCalendarSelections.connectionId, command.connectionId),
            eq(googleCalendarSelections.producerId, command.producerId),
            eq(googleCalendarSelections.accountVersion, command.accountVersion),
          ),
        )
        .orderBy(
          desc(googleCalendarSelections.isPrimary),
          asc(googleCalendarSelections.displayName),
          asc(googleCalendarSelections.id),
        );
      return rows.map(selectionRecord);
    },

    async getConnectionSyncSummary(command) {
      const scope = and(
        eq(bookingCalendarLinks.producerId, command.producerId),
        eq(bookingCalendarLinks.connectionId, command.connectionId),
        eq(bookingCalendarLinks.accountVersion, command.accountVersion),
      );
      const attentionVisible = sql<boolean>`(
        ${bookingCalendarLinks.attentionDismissedAt} IS NULL
        OR ${bookingCalendarLinks.attentionDismissedAt} < ${bookingCalendarLinks.syncStateChangedAt}
      )`;
      const [[row], issues] = await Promise.all([
        db
          .select({
            syncing: sql<number>`count(*) filter (where ${bookingCalendarLinks.syncState} = 'pending')::integer`,
            notSynced: sql<number>`count(*) filter (where ${bookingCalendarLinks.syncState} = 'not_synced' AND ${attentionVisible})::integer`,
            missing: sql<number>`count(*) filter (where ${bookingCalendarLinks.syncState} = 'missing' AND ${attentionVisible})::integer`,
            conflicts: sql<number>`count(*) filter (where ${bookingCalendarLinks.syncState} = 'conflict' AND ${attentionVisible})::integer`,
          })
          .from(bookingCalendarLinks)
          .where(scope),
        db
          .select({
            bookingId: bookings.id,
            syncState: bookingCalendarLinks.syncState,
            bookingStatus: bookings.status,
            artistName: bookings.artistName,
            startsAt: bookings.startsAt,
            durationMin: bookings.durationMin,
            syncStateChangedAt: bookingCalendarLinks.syncStateChangedAt,
          })
          .from(bookingCalendarLinks)
          .innerJoin(
            bookings,
            and(
              eq(bookings.id, bookingCalendarLinks.currentBookingId),
              eq(bookings.producerId, bookingCalendarLinks.producerId),
            ),
          )
          .where(
            and(
              scope,
              inArray(bookingCalendarLinks.syncState, ["not_synced", "missing", "conflict"]),
              attentionVisible,
            ),
          )
          .orderBy(desc(bookingCalendarLinks.syncStateChangedAt), desc(bookings.startsAt))
          .limit(25),
      ]);
      return {
        syncing: row?.syncing ?? 0,
        notSynced: row?.notSynced ?? 0,
        missing: row?.missing ?? 0,
        conflicts: row?.conflicts ?? 0,
        issues: issues.map((issue) => ({
          ...issue,
          syncState: issue.syncState as "not_synced" | "missing" | "conflict",
        })),
      };
    },

    async listCalendarWatches(command) {
      const rows = await db
        .select()
        .from(googleCalendarWatches)
        .where(
          and(
            eq(googleCalendarWatches.producerId, command.producerId),
            eq(googleCalendarWatches.connectionId, command.connectionId),
            eq(googleCalendarWatches.accountVersion, command.accountVersion),
            inArray(googleCalendarWatches.state, ["renewing", "active"]),
          ),
        )
        .orderBy(asc(googleCalendarWatches.createdAt), asc(googleCalendarWatches.id));
      return rows.map(watchRecord);
    },

    async listRequiredCalendarWatchTargets(command) {
      if (Number.isNaN(command.now.getTime())) {
        throw new Error("Invalid Google Calendar watch target time");
      }
      const targetColumns = {
        producerId: googleCalendarSelections.producerId,
        connectionId: googleCalendarSelections.connectionId,
        accountVersion: googleCalendarSelections.accountVersion,
        destinationSelectionId: googleCalendarSelections.id,
        destinationCalendarIdCiphertext: googleCalendarSelections.providerCalendarIdCiphertext,
        destinationCalendarIdIv: googleCalendarSelections.providerCalendarIdIv,
        destinationCalendarIdAuthTag: googleCalendarSelections.providerCalendarIdAuthTag,
        destinationCalendarIdKeyVersion: googleCalendarSelections.providerCalendarIdKeyVersion,
        destinationCalendarIdFingerprint: googleCalendarSelections.providerCalendarIdFingerprint,
      };
      const [currentDestinations, linkedDestinations] = await Promise.all([
        db
          .select(targetColumns)
          .from(googleCalendarSelections)
          .innerJoin(
            googleCalendarConnections,
            and(
              eq(googleCalendarConnections.id, googleCalendarSelections.connectionId),
              eq(googleCalendarConnections.producerId, googleCalendarSelections.producerId),
              eq(googleCalendarConnections.accountVersion, googleCalendarSelections.accountVersion),
            ),
          )
          .where(
            and(
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
              eq(googleCalendarSelections.isDestination, true),
              eq(googleCalendarConnections.status, "connected"),
            ),
          )
          .orderBy(asc(googleCalendarSelections.id)),
        db
          .select({
            producerId: bookingCalendarLinks.producerId,
            connectionId: bookingCalendarLinks.connectionId,
            accountVersion: bookingCalendarLinks.accountVersion,
            destinationSelectionId: bookingCalendarLinks.destinationSelectionId,
            destinationCalendarIdCiphertext: bookingCalendarLinks.destinationCalendarIdCiphertext,
            destinationCalendarIdIv: bookingCalendarLinks.destinationCalendarIdIv,
            destinationCalendarIdAuthTag: bookingCalendarLinks.destinationCalendarIdAuthTag,
            destinationCalendarIdKeyVersion: bookingCalendarLinks.destinationCalendarIdKeyVersion,
            destinationCalendarIdFingerprint: bookingCalendarLinks.destinationCalendarIdFingerprint,
          })
          .from(bookingCalendarLinks)
          .innerJoin(
            bookings,
            and(
              eq(bookings.id, bookingCalendarLinks.currentBookingId),
              eq(bookings.producerId, bookingCalendarLinks.producerId),
              eq(bookings.allowanceUseId, bookingCalendarLinks.allowanceUseId),
            ),
          )
          .innerJoin(
            googleCalendarConnections,
            and(
              eq(googleCalendarConnections.id, bookingCalendarLinks.connectionId),
              eq(googleCalendarConnections.producerId, bookingCalendarLinks.producerId),
              eq(googleCalendarConnections.accountVersion, bookingCalendarLinks.accountVersion),
            ),
          )
          .where(
            and(
              eq(bookingCalendarLinks.producerId, command.producerId),
              eq(bookingCalendarLinks.connectionId, command.connectionId),
              eq(bookingCalendarLinks.accountVersion, command.accountVersion),
              eq(bookingCalendarLinks.providerState, "active"),
              inArray(bookings.status, ["pending_approval", "confirmed"]),
              gt(bookings.startsAt, command.now),
              eq(googleCalendarConnections.status, "connected"),
            ),
          )
          .orderBy(
            asc(bookings.startsAt),
            asc(bookingCalendarLinks.destinationCalendarIdFingerprint),
            asc(bookingCalendarLinks.id),
          ),
      ]);
      const targets: GoogleCalendarWatchTarget[] = [];
      const fingerprints = new Set<string>();
      for (const row of [...currentDestinations, ...linkedDestinations]) {
        if (fingerprints.has(row.destinationCalendarIdFingerprint)) continue;
        fingerprints.add(row.destinationCalendarIdFingerprint);
        targets.push(watchTargetRecord(row));
      }
      return targets;
    },

    async reserveCalendarWatch(command) {
      const [inserted] = await db
        .insert(googleCalendarWatches)
        .values({
          id: command.id,
          producerId: command.producerId,
          connectionId: command.connectionId,
          accountVersion: command.accountVersion,
          destinationSelectionId: command.destinationSelectionId,
          destinationCalendarIdCiphertext: command.destinationCalendarId.ciphertext,
          destinationCalendarIdIv: command.destinationCalendarId.iv,
          destinationCalendarIdAuthTag: command.destinationCalendarId.authTag,
          destinationCalendarIdKeyVersion: command.destinationCalendarId.keyVersion,
          destinationCalendarIdFingerprint: command.destinationCalendarIdFingerprint,
          renewalOfWatchId: command.renewalOfWatchId,
          providerChannelId: command.providerChannelId,
          providerResourceId: null,
          channelTokenDigest: command.channelTokenDigest,
          state: "renewing",
          expiresAt: null,
          createdAt: command.reservedAt,
          updatedAt: command.reservedAt,
        })
        .onConflictDoNothing()
        .returning();
      return inserted ? watchRecord(inserted) : null;
    },

    async activateCalendarWatch(command) {
      return db.transaction(async (tx) => {
        const [reserved] = await tx
          .select()
          .from(googleCalendarWatches)
          .where(
            and(
              eq(googleCalendarWatches.id, command.watchId),
              eq(googleCalendarWatches.producerId, command.producerId),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !reserved ||
          reserved.state !== "renewing" ||
          reserved.providerResourceId !== null ||
          reserved.expiresAt !== null ||
          command.expiresAt.getTime() <= command.activatedAt.getTime()
        ) {
          return false;
        }
        const [active] = await tx
          .select()
          .from(googleCalendarWatches)
          .where(
            and(
              eq(googleCalendarWatches.connectionId, reserved.connectionId),
              eq(googleCalendarWatches.producerId, reserved.producerId),
              eq(googleCalendarWatches.accountVersion, reserved.accountVersion),
              eq(
                googleCalendarWatches.destinationCalendarIdFingerprint,
                reserved.destinationCalendarIdFingerprint,
              ),
              eq(googleCalendarWatches.state, "active"),
            ),
          )
          .limit(1)
          .for("update");
        if (
          (active && reserved.renewalOfWatchId !== active.id) ||
          (!active && reserved.renewalOfWatchId !== null)
        ) {
          return false;
        }
        if (active) {
          await tx
            .update(googleCalendarWatches)
            .set({
              state: "retired",
              endedAt: command.activatedAt,
              lastErrorCode: null,
              updatedAt: advancedTimestamp(googleCalendarWatches.updatedAt, command.activatedAt),
            })
            .where(
              and(
                eq(googleCalendarWatches.id, active.id),
                eq(googleCalendarWatches.producerId, active.producerId),
                eq(googleCalendarWatches.state, "active"),
              ),
            );
        }
        const [activated] = await tx
          .update(googleCalendarWatches)
          .set({
            providerResourceId: command.providerResourceId,
            state: "active",
            expiresAt: command.expiresAt,
            activatedAt: command.activatedAt,
            lastErrorCode: null,
            updatedAt: advancedTimestamp(googleCalendarWatches.updatedAt, command.activatedAt),
          })
          .where(
            and(
              eq(googleCalendarWatches.id, reserved.id),
              eq(googleCalendarWatches.producerId, reserved.producerId),
              eq(googleCalendarWatches.state, "renewing"),
              isNull(googleCalendarWatches.providerResourceId),
            ),
          )
          .returning({ id: googleCalendarWatches.id });
        return activated !== undefined;
      });
    },

    async endCalendarWatch(command) {
      const [ended] = await db
        .update(googleCalendarWatches)
        .set({
          state: command.state,
          endedAt: command.endedAt,
          lastErrorCode: command.errorCode,
          updatedAt: advancedTimestamp(googleCalendarWatches.updatedAt, command.endedAt),
        })
        .where(
          and(
            eq(googleCalendarWatches.id, command.watchId),
            eq(googleCalendarWatches.producerId, command.producerId),
            inArray(googleCalendarWatches.state, ["renewing", "active"]),
          ),
        )
        .returning({ id: googleCalendarWatches.id });
      return ended !== undefined;
    },

    async listCalendarWatchesDueForRenewal(command) {
      if (
        Number.isNaN(command.renewBefore.getTime()) ||
        !Number.isSafeInteger(command.limit) ||
        command.limit < 1 ||
        command.limit > 100
      ) {
        throw new Error("Invalid Google Calendar watch renewal batch");
      }
      const rows = await db
        .select({ watch: googleCalendarWatches })
        .from(googleCalendarWatches)
        .innerJoin(
          googleCalendarConnections,
          and(
            eq(googleCalendarConnections.id, googleCalendarWatches.connectionId),
            eq(googleCalendarConnections.producerId, googleCalendarWatches.producerId),
            eq(googleCalendarConnections.accountVersion, googleCalendarWatches.accountVersion),
          ),
        )
        .where(
          and(
            eq(googleCalendarConnections.status, "connected"),
            eq(googleCalendarWatches.state, "active"),
            lte(googleCalendarWatches.expiresAt, command.renewBefore),
          ),
        )
        .orderBy(asc(googleCalendarWatches.expiresAt), asc(googleCalendarWatches.id))
        .limit(command.limit);
      return rows.map((row) => watchRecord(row.watch));
    },

    async listCalendarWatchRepairProducerIds(command) {
      if (
        Number.isNaN(command.now.getTime()) ||
        !Number.isSafeInteger(command.limit) ||
        command.limit < 1 ||
        command.limit > 100
      ) {
        throw new Error("Invalid Google Calendar watch repair batch");
      }
      const missingCurrent = await db
        .selectDistinct({ producerId: googleCalendarConnections.producerId })
        .from(googleCalendarConnections)
        .innerJoin(
          googleCalendarSelections,
          and(
            eq(googleCalendarSelections.connectionId, googleCalendarConnections.id),
            eq(googleCalendarSelections.producerId, googleCalendarConnections.producerId),
            eq(googleCalendarSelections.accountVersion, googleCalendarConnections.accountVersion),
            eq(googleCalendarSelections.isDestination, true),
          ),
        )
        .where(
          and(
            eq(googleCalendarConnections.status, "connected"),
            notExists(
              db
                .select({ one: sql<number>`1` })
                .from(googleCalendarWatches)
                .where(
                  and(
                    eq(googleCalendarWatches.connectionId, googleCalendarConnections.id),
                    eq(googleCalendarWatches.producerId, googleCalendarConnections.producerId),
                    eq(
                      googleCalendarWatches.accountVersion,
                      googleCalendarConnections.accountVersion,
                    ),
                    eq(
                      googleCalendarWatches.destinationCalendarIdFingerprint,
                      googleCalendarSelections.providerCalendarIdFingerprint,
                    ),
                    inArray(googleCalendarWatches.state, ["renewing", "active"]),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(googleCalendarConnections.producerId))
        .limit(command.limit);
      const missingLinked = await db
        .selectDistinct({ producerId: bookingCalendarLinks.producerId })
        .from(bookingCalendarLinks)
        .innerJoin(
          bookings,
          and(
            eq(bookings.id, bookingCalendarLinks.currentBookingId),
            eq(bookings.producerId, bookingCalendarLinks.producerId),
            eq(bookings.allowanceUseId, bookingCalendarLinks.allowanceUseId),
          ),
        )
        .innerJoin(
          googleCalendarConnections,
          and(
            eq(googleCalendarConnections.id, bookingCalendarLinks.connectionId),
            eq(googleCalendarConnections.producerId, bookingCalendarLinks.producerId),
            eq(googleCalendarConnections.accountVersion, bookingCalendarLinks.accountVersion),
          ),
        )
        .where(
          and(
            eq(googleCalendarConnections.status, "connected"),
            eq(bookingCalendarLinks.providerState, "active"),
            inArray(bookings.status, ["pending_approval", "confirmed"]),
            gt(bookings.startsAt, command.now),
            notExists(
              db
                .select({ one: sql<number>`1` })
                .from(googleCalendarWatches)
                .where(
                  and(
                    eq(googleCalendarWatches.connectionId, bookingCalendarLinks.connectionId),
                    eq(googleCalendarWatches.producerId, bookingCalendarLinks.producerId),
                    eq(googleCalendarWatches.accountVersion, bookingCalendarLinks.accountVersion),
                    eq(
                      googleCalendarWatches.destinationCalendarIdFingerprint,
                      bookingCalendarLinks.destinationCalendarIdFingerprint,
                    ),
                    inArray(googleCalendarWatches.state, ["renewing", "active"]),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(bookingCalendarLinks.producerId))
        .limit(command.limit);
      const staleWatch = await db
        .selectDistinct({ producerId: googleCalendarWatches.producerId })
        .from(googleCalendarWatches)
        .innerJoin(
          googleCalendarConnections,
          and(
            eq(googleCalendarConnections.id, googleCalendarWatches.connectionId),
            eq(googleCalendarConnections.producerId, googleCalendarWatches.producerId),
            eq(googleCalendarConnections.accountVersion, googleCalendarWatches.accountVersion),
          ),
        )
        .where(
          and(
            eq(googleCalendarConnections.status, "connected"),
            inArray(googleCalendarWatches.state, ["renewing", "active"]),
            notExists(
              db
                .select({ one: sql<number>`1` })
                .from(googleCalendarSelections)
                .where(
                  and(
                    eq(googleCalendarSelections.connectionId, googleCalendarWatches.connectionId),
                    eq(googleCalendarSelections.producerId, googleCalendarWatches.producerId),
                    eq(
                      googleCalendarSelections.accountVersion,
                      googleCalendarWatches.accountVersion,
                    ),
                    eq(googleCalendarSelections.isDestination, true),
                    eq(
                      googleCalendarSelections.providerCalendarIdFingerprint,
                      googleCalendarWatches.destinationCalendarIdFingerprint,
                    ),
                  ),
                ),
            ),
            notExists(
              db
                .select({ one: sql<number>`1` })
                .from(bookingCalendarLinks)
                .innerJoin(
                  bookings,
                  and(
                    eq(bookings.id, bookingCalendarLinks.currentBookingId),
                    eq(bookings.producerId, bookingCalendarLinks.producerId),
                    eq(bookings.allowanceUseId, bookingCalendarLinks.allowanceUseId),
                  ),
                )
                .where(
                  and(
                    eq(bookingCalendarLinks.connectionId, googleCalendarWatches.connectionId),
                    eq(bookingCalendarLinks.producerId, googleCalendarWatches.producerId),
                    eq(bookingCalendarLinks.accountVersion, googleCalendarWatches.accountVersion),
                    eq(
                      bookingCalendarLinks.destinationCalendarIdFingerprint,
                      googleCalendarWatches.destinationCalendarIdFingerprint,
                    ),
                    eq(bookingCalendarLinks.providerState, "active"),
                    inArray(bookings.status, ["pending_approval", "confirmed"]),
                    gt(bookings.startsAt, command.now),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(googleCalendarWatches.producerId))
        .limit(command.limit);
      return [
        ...new Set(
          [...missingCurrent, ...missingLinked, ...staleWatch].map((row) => row.producerId),
        ),
      ]
        .sort()
        .slice(0, command.limit);
    },

    async saveCalendarSelection(command) {
      return db.transaction(async (tx) => {
        const connection = await lockedConnection(tx, command.producerId);
        if (
          !connection ||
          connection.id !== command.connectionId ||
          connection.accountVersion !== command.accountVersion ||
          connection.status === "disconnected" ||
          connection.status === "reconnect_required"
        ) {
          return "stale" as const;
        }
        const rows = await tx
          .select()
          .from(googleCalendarSelections)
          .where(
            and(
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
            ),
          )
          .for("update");
        const destination = rows.find((row) => row.id === command.destinationCalendarId);
        const available = new Set(rows.map((row) => row.id));
        if (
          !destination ||
          (destination.accessRole !== "writer" && destination.accessRole !== "owner") ||
          command.availabilityCalendarIds.length < 1 ||
          new Set(command.availabilityCalendarIds).size !==
            command.availabilityCalendarIds.length ||
          command.availabilityCalendarIds.some((id) => !available.has(id))
        ) {
          return "invalid_selection" as const;
        }
        await tx
          .update(googleCalendarSelections)
          .set({
            isDestination: false,
            updatedAt: advancedTimestamp(googleCalendarSelections.updatedAt, command.savedAt),
          })
          .where(
            and(
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
              eq(googleCalendarSelections.isDestination, true),
            ),
          );
        await tx
          .update(googleCalendarSelections)
          .set({
            isDestination: sql`${googleCalendarSelections.id} = ${command.destinationCalendarId}`,
            blocksAvailability: inArray(googleCalendarSelections.id, [
              ...command.availabilityCalendarIds,
            ]),
            updatedAt: advancedTimestamp(
              googleCalendarSelections.updatedAt,
              new Date(command.savedAt.getTime() + 1),
            ),
          })
          .where(
            and(
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
            ),
          );
        await tx
          .update(googleCalendarConnections)
          .set({
            status: "connected",
            reconnectRequiredAt: null,
            disconnectedAt: null,
            lastErrorCode: null,
            updatedAt: advancedTimestamp(googleCalendarConnections.updatedAt, command.savedAt),
          })
          .where(
            and(
              eq(googleCalendarConnections.id, command.connectionId),
              eq(googleCalendarConnections.producerId, command.producerId),
              eq(googleCalendarConnections.accountVersion, command.accountVersion),
            ),
          );
        return "saved" as const;
      });
    },

    async enqueueFutureConfirmedEvents(command) {
      if (
        Number.isNaN(command.now.getTime()) ||
        !Number.isSafeInteger(command.limit) ||
        command.limit < 1 ||
        command.limit > 500
      ) {
        throw new Error("Invalid Google Calendar initial sync batch");
      }
      return db.transaction(async (tx) => {
        const candidates = await tx
          .select({
            bookingId: bookings.id,
            producerId: bookings.producerId,
            allowanceUseId: bookings.allowanceUseId,
            startsAt: bookings.startsAt,
            durationMin: bookings.durationMin,
            projectTitle: projects.title,
            producerName: producers.displayName,
            artistName: bookings.artistName,
            artistEmail: bookings.artistEmail,
            calendarRevision: bookings.calendarRevision,
            connectionId: googleCalendarConnections.id,
            accountVersion: googleCalendarConnections.accountVersion,
            destinationSelectionId: googleCalendarSelections.id,
            destinationCalendarIdCiphertext: googleCalendarSelections.providerCalendarIdCiphertext,
            destinationCalendarIdIv: googleCalendarSelections.providerCalendarIdIv,
            destinationCalendarIdAuthTag: googleCalendarSelections.providerCalendarIdAuthTag,
            destinationCalendarIdKeyVersion: googleCalendarSelections.providerCalendarIdKeyVersion,
            destinationCalendarIdFingerprint:
              googleCalendarSelections.providerCalendarIdFingerprint,
          })
          .from(bookings)
          .innerJoin(
            projects,
            and(eq(projects.id, bookings.projectId), eq(projects.producerId, bookings.producerId)),
          )
          .innerJoin(producers, eq(producers.id, bookings.producerId))
          .innerJoin(
            googleCalendarConnections,
            and(
              eq(googleCalendarConnections.producerId, bookings.producerId),
              eq(googleCalendarConnections.status, "connected"),
            ),
          )
          .innerJoin(
            googleCalendarSelections,
            and(
              eq(googleCalendarSelections.connectionId, googleCalendarConnections.id),
              eq(googleCalendarSelections.producerId, googleCalendarConnections.producerId),
              eq(googleCalendarSelections.accountVersion, googleCalendarConnections.accountVersion),
              eq(googleCalendarSelections.isDestination, true),
            ),
          )
          .where(
            and(
              eq(bookings.status, "confirmed"),
              gt(bookings.startsAt, command.now),
              gt(bookings.calendarRevision, 0),
              command.producerId ? eq(bookings.producerId, command.producerId) : undefined,
              notExists(
                tx
                  .select({ one: sql<number>`1` })
                  .from(bookingCalendarLinks)
                  .innerJoin(
                    calendarSyncJobs,
                    and(
                      eq(calendarSyncJobs.bookingCalendarLinkId, bookingCalendarLinks.id),
                      eq(calendarSyncJobs.producerId, bookingCalendarLinks.producerId),
                    ),
                  )
                  .where(
                    and(
                      eq(bookingCalendarLinks.producerId, bookings.producerId),
                      eq(bookingCalendarLinks.allowanceUseId, bookings.allowanceUseId),
                      eq(bookingCalendarLinks.connectionId, googleCalendarConnections.id),
                      eq(
                        bookingCalendarLinks.accountVersion,
                        googleCalendarConnections.accountVersion,
                      ),
                      eq(calendarSyncJobs.deliveryChannel, "google"),
                      eq(calendarSyncJobs.operation, "upsert_google_event"),
                      eq(calendarSyncJobs.desiredRevision, bookings.calendarRevision),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(asc(bookings.startsAt), asc(bookings.id))
          .limit(command.limit);

        let linksCreated = 0;
        let jobsEnqueued = 0;
        const jobIds: string[] = [];
        for (const candidate of candidates) {
          const [priorIcsInvitation] = await tx
            .select({ completedAt: calendarSyncJobs.completedAt })
            .from(calendarSyncJobs)
            .where(
              and(
                eq(calendarSyncJobs.bookingId, candidate.bookingId),
                eq(calendarSyncJobs.producerId, candidate.producerId),
                eq(calendarSyncJobs.deliveryChannel, "ics"),
                eq(calendarSyncJobs.operation, "send_ics"),
                eq(calendarSyncJobs.desiredRevision, candidate.calendarRevision),
                eq(calendarSyncJobs.status, "completed"),
              ),
            )
            .orderBy(desc(calendarSyncJobs.updatedAt))
            .limit(1);
          const preserveIcsInvitation =
            priorIcsInvitation?.completedAt !== undefined &&
            priorIcsInvitation.completedAt !== null;
          const linkId = randomUUID();
          const [created] = await tx
            .insert(bookingCalendarLinks)
            .select(
              tx
                .select({
                  id: sql<string>`${linkId}`.as("id"),
                  producerId: googleCalendarConnections.producerId,
                  allowanceUseId: sql<string>`${candidate.allowanceUseId}`.as("allowance_use_id"),
                  originBookingId: sql<string>`${candidate.bookingId}`.as("origin_booking_id"),
                  currentBookingId: sql<string>`${candidate.bookingId}`.as("current_booking_id"),
                  connectionId: googleCalendarConnections.id,
                  accountVersion: googleCalendarConnections.accountVersion,
                  destinationSelectionId: googleCalendarSelections.id,
                  destinationCalendarIdCiphertext:
                    googleCalendarSelections.providerCalendarIdCiphertext,
                  destinationCalendarIdIv: googleCalendarSelections.providerCalendarIdIv,
                  destinationCalendarIdAuthTag: googleCalendarSelections.providerCalendarIdAuthTag,
                  destinationCalendarIdKeyVersion:
                    googleCalendarSelections.providerCalendarIdKeyVersion,
                  destinationCalendarIdFingerprint:
                    googleCalendarSelections.providerCalendarIdFingerprint,
                  providerEventId: sql<string>`${`sk${linkId.replaceAll("-", "")}`}`.as(
                    "provider_event_id",
                  ),
                  providerEventEtag: sql<string | null>`null`.as("provider_event_etag"),
                  providerState: sql<"uncreated">`'uncreated'`.as("provider_state"),
                  desiredRevision: sql<number>`${candidate.calendarRevision}`.as(
                    "desired_revision",
                  ),
                  lastGoogleRevision: sql<number>`0`.as("last_google_revision"),
                  lastGoogleSyncedAt: sql<Date | null>`null`.as("last_google_synced_at"),
                  invitationRevision: sql<number>`${
                    preserveIcsInvitation ? candidate.calendarRevision : 0
                  }`.as("invitation_revision"),
                  invitationChannel: sql<"ics" | "google" | null>`${
                    preserveIcsInvitation ? "ics" : null
                  }`.as("invitation_channel"),
                  invitationReservedAt: sql<Date | null>`${
                    preserveIcsInvitation ? command.now : null
                  }`.as("invitation_reserved_at"),
                  invitationAttemptedAt: sql<Date | null>`null`.as("invitation_attempted_at"),
                  invitationDeliveredAt: sql<Date | null>`${
                    preserveIcsInvitation ? command.now : null
                  }`.as("invitation_delivered_at"),
                  createdAt: sql<Date>`${command.now}`.as("created_at"),
                  updatedAt: sql<Date>`${command.now}`.as("updated_at"),
                })
                .from(googleCalendarConnections)
                .innerJoin(
                  googleCalendarSelections,
                  and(
                    eq(googleCalendarSelections.connectionId, googleCalendarConnections.id),
                    eq(googleCalendarSelections.producerId, googleCalendarConnections.producerId),
                    eq(
                      googleCalendarSelections.accountVersion,
                      googleCalendarConnections.accountVersion,
                    ),
                  ),
                )
                .where(
                  and(
                    eq(googleCalendarConnections.id, candidate.connectionId),
                    eq(googleCalendarConnections.producerId, candidate.producerId),
                    eq(googleCalendarConnections.accountVersion, candidate.accountVersion),
                    eq(googleCalendarConnections.status, "connected"),
                    eq(googleCalendarSelections.id, candidate.destinationSelectionId),
                    eq(googleCalendarSelections.isDestination, true),
                  ),
                )
                .limit(1),
            )
            .onConflictDoNothing({
              target: [
                bookingCalendarLinks.producerId,
                bookingCalendarLinks.allowanceUseId,
                bookingCalendarLinks.connectionId,
                bookingCalendarLinks.accountVersion,
              ],
            })
            .returning({ id: bookingCalendarLinks.id });
          if (created) linksCreated += 1;

          const [existingLink] = await tx
            .select()
            .from(bookingCalendarLinks)
            .where(
              and(
                eq(bookingCalendarLinks.producerId, candidate.producerId),
                eq(bookingCalendarLinks.allowanceUseId, candidate.allowanceUseId),
                eq(bookingCalendarLinks.connectionId, candidate.connectionId),
                eq(bookingCalendarLinks.accountVersion, candidate.accountVersion),
              ),
            )
            .limit(1);
          const hasPreservedIcsInvitation =
            existingLink?.invitationRevision === candidate.calendarRevision &&
            existingLink.invitationChannel === "ics" &&
            existingLink.invitationDeliveredAt !== null;
          if (
            !existingLink ||
            (existingLink.invitationRevision > 0 && !hasPreservedIcsInvitation) ||
            existingLink.desiredRevision > candidate.calendarRevision
          ) {
            continue;
          }

          let link = existingLink;
          if (
            existingLink.desiredRevision < candidate.calendarRevision ||
            existingLink.currentBookingId !== candidate.bookingId
          ) {
            const [advanced] = await tx
              .update(bookingCalendarLinks)
              .set({
                currentBookingId: candidate.bookingId,
                desiredRevision: candidate.calendarRevision,
                updatedAt: advancedTimestamp(bookingCalendarLinks.updatedAt, command.now),
              })
              .where(
                and(
                  eq(bookingCalendarLinks.id, existingLink.id),
                  eq(bookingCalendarLinks.producerId, existingLink.producerId),
                  eq(bookingCalendarLinks.desiredRevision, existingLink.desiredRevision),
                  eq(bookingCalendarLinks.invitationRevision, 0),
                ),
              )
              .returning();
            if (!advanced) continue;
            link = advanced;
          }

          const privateProperties = {
            skitzaLink: link.id,
            skitzaRevision: String(candidate.calendarRevision),
            skitzaSchema: "1" as const,
          };
          const projectName = candidate.projectTitle.trim() || "Session";
          const producerName = candidate.producerName?.trim() || "Skitza producer";
          const artistName = candidate.artistName.trim() || "Artist";
          const payloadSnapshot: GoogleCalendarSyncJobPayloadSnapshot = {
            schemaVersion: 2,
            action: "upsert",
            eventKind: "confirmed",
            notificationMode: "none",
            sequence: candidate.calendarRevision,
            startsAtUtc: candidate.startsAt.toISOString(),
            endsAtUtc: new Date(
              candidate.startsAt.getTime() + candidate.durationMin * 60 * 1_000,
            ).toISOString(),
            summary: `${projectName} · ${producerName} & ${artistName}`,
            artistSafeUrl: `https://skitza.app/artist/sessions/${candidate.bookingId}`,
            attendee: { name: candidate.artistName, email: candidate.artistEmail },
            privateProperties,
          };
          const [inserted] = await tx
            .insert(calendarSyncJobs)
            .values({
              bookingId: candidate.bookingId,
              producerId: candidate.producerId,
              deliveryChannel: "google",
              bookingCalendarLinkId: link.id,
              operation: "upsert_google_event",
              status: "pending",
              desiredRevision: candidate.calendarRevision,
              idempotencyKey: `google:initial:${link.id}:r${String(candidate.calendarRevision)}`,
              payloadSnapshot,
              nextAttemptAt: command.now,
              createdAt: command.now,
              updatedAt: command.now,
            })
            .onConflictDoNothing()
            .returning({ id: calendarSyncJobs.id });
          if (inserted) {
            jobsEnqueued += 1;
            jobIds.push(inserted.id);
          }
        }
        return { scanned: candidates.length, linksCreated, jobsEnqueued, jobIds };
      });
    },

    async disconnect(command) {
      return db.transaction(async (tx) => {
        const connection = await lockedConnection(tx, command.producerId);
        if (!connection) return false;
        if (connection.status === "disconnected") return true;
        if (
          connection.id !== command.connectionId ||
          connection.accountVersion !== command.accountVersion
        ) {
          return false;
        }
        await tx
          .update(googleCalendarWatches)
          .set({
            state: "retired",
            endedAt: command.disconnectedAt,
            lastErrorCode: null,
            updatedAt: advancedTimestamp(googleCalendarWatches.updatedAt, command.disconnectedAt),
          })
          .where(
            and(
              eq(googleCalendarWatches.connectionId, command.connectionId),
              eq(googleCalendarWatches.producerId, command.producerId),
              eq(googleCalendarWatches.accountVersion, command.accountVersion),
              inArray(googleCalendarWatches.state, ["renewing", "active"]),
            ),
          );
        await tx
          .delete(googleCalendarSelections)
          .where(
            and(
              eq(googleCalendarSelections.connectionId, command.connectionId),
              eq(googleCalendarSelections.producerId, command.producerId),
              eq(googleCalendarSelections.accountVersion, command.accountVersion),
            ),
          );
        await tx
          .delete(googleCalendarOAuthStates)
          .where(
            and(
              eq(googleCalendarOAuthStates.connectionId, command.connectionId),
              eq(googleCalendarOAuthStates.producerId, command.producerId),
              isNull(googleCalendarOAuthStates.consumedAt),
            ),
          );
        const [updated] = await tx
          .update(googleCalendarConnections)
          .set({
            status: "disconnected",
            accessTokenCiphertext: null,
            accessTokenIv: null,
            accessTokenAuthTag: null,
            accessTokenKeyVersion: null,
            accessTokenExpiresAt: null,
            refreshTokenCiphertext: null,
            refreshTokenIv: null,
            refreshTokenAuthTag: null,
            refreshTokenKeyVersion: null,
            refreshTokenUpdatedAt: null,
            reconnectRequiredAt: null,
            disconnectedAt: advancedTimestamp(
              googleCalendarConnections.updatedAt,
              command.disconnectedAt,
            ),
            lastErrorCode: null,
            updatedAt: advancedTimestamp(
              googleCalendarConnections.updatedAt,
              command.disconnectedAt,
            ),
          })
          .where(
            and(
              eq(googleCalendarConnections.id, command.connectionId),
              eq(googleCalendarConnections.producerId, command.producerId),
              eq(googleCalendarConnections.accountVersion, command.accountVersion),
            ),
          )
          .returning({ id: googleCalendarConnections.id });
        return updated !== undefined;
      });
    },
  };
}
