import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  notInArray,
  sql,
  googleCalendarConnections,
  googleCalendarOAuthStates,
  googleCalendarSelections,
  type Db,
  type GoogleCalendarConnection,
  type GoogleCalendarOAuthState,
  type GoogleCalendarSelection,
} from "@skitza/db";

import type { EncryptedGoogleCalendarValue } from "./crypto";
import type {
  GoogleCalendarCandidateRecord,
  GoogleCalendarConnectionRecord,
  GoogleCalendarRepository,
  GoogleCalendarStoredOAuthState,
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
