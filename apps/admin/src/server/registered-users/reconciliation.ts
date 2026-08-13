import { createHash } from "node:crypto";

import { createClerkClient } from "@clerk/backend";
import {
  canonicalFoundationDigest,
  createClerkIdentityBindingRepository,
  resolveCanonicalClerkUserId,
  type Db,
  type FoundationEnvironment,
  registeredAccounts,
  sql,
} from "@skitza/db";

import {
  purgeAdminHistoryInTransaction,
  recordAdminActionInTransaction,
} from "~/server/data-foundation/repository";
import {
  buildRegisteredAccountsReconciliationCommand,
  type RecordAdminActionCommand,
} from "~/server/data-foundation/service";
import type {
  RegisteredAccountAudienceType,
  RegisteredAccountProviderState,
} from "./reconciliation-types";

const PAGE_LIMIT = 100;
const MAX_USERS = 100_000;

type ReconciliationCursor = Readonly<{
  clerkInstanceId: string;
  offset: number;
  version: 1;
}>;

export type ReconciliationProviderUser = Readonly<{
  banned: boolean;
  createdAt: number;
  emailAddresses: readonly Readonly<{
    emailAddress: string;
    id: string;
    verificationStatus: string | null;
  }>[];
  firstName: string | null;
  id: string;
  lastName: string | null;
  lastSignInAt: number | null;
  locked: boolean;
  primaryEmailAddressId: string | null;
  privateMetadata: Readonly<Record<string, unknown>>;
  updatedAt: number;
  username: string | null;
}>;

export type ReconciliationSnapshot = Readonly<{
  audienceType: RegisteredAccountAudienceType;
  clerkUserId: string;
  providerClerkUserId: string;
  clerkInstanceId: string;
  displayName: string | null;
  emailVerified: boolean | null;
  lastSignInAt: Date | null;
  primaryEmail: string | null;
  providerCreatedAt: Date;
  providerState: RegisteredAccountProviderState;
  providerUpdatedAt: Date;
  sourceId: string;
}>;

export interface RegisteredAccountReconciliationProvider {
  getInstanceId(): Promise<string>;
  getPage(input: Readonly<{ limit: number; offset: number }>): Promise<
    Readonly<{
      data: readonly ReconciliationProviderUser[];
      totalCount: number;
    }>
  >;
}

export interface RegisteredAccountReconciliationRepository {
  readonly applySnapshots: (
    input: Readonly<{
      audit: RecordAdminActionCommand;
      snapshots: readonly ReconciliationSnapshot[];
    }>,
  ) => Promise<Readonly<{ applied: number; replayed: boolean }>>;
}

export interface RegisteredAccountReconciliationIdentityResolver {
  readonly resolveCanonicalUserId: (
    input: Readonly<{
      clerkInstanceId: string;
      providerClerkUserId: string;
    }>,
  ) => Promise<string>;
}

export function createRegisteredAccountReconciliationIdentityResolver(
  db: Pick<Db, "select">,
): RegisteredAccountReconciliationIdentityResolver {
  const repository = createClerkIdentityBindingRepository(db);
  return {
    async resolveCanonicalUserId(identity) {
      try {
        return await resolveCanonicalClerkUserId(repository, identity);
      } catch {
        throw new RegisteredAccountReconciliationError();
      }
    },
  };
}

export type RegisteredAccountReconciliationErrorCode = "INVALID_REQUEST" | "UNAVAILABLE";

export class RegisteredAccountReconciliationError extends Error {
  constructor(readonly code: RegisteredAccountReconciliationErrorCode = "UNAVAILABLE") {
    super("REGISTERED_ACCOUNT_RECONCILIATION_FAILED");
    this.name = "RegisteredAccountReconciliationError";
  }
}

function encodeReconciliationCursor(cursor: ReconciliationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeReconciliationCursor(value: string, clerkInstanceId: string): ReconciliationCursor {
  if (value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RegisteredAccountReconciliationError("INVALID_REQUEST");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new RegisteredAccountReconciliationError("INVALID_REQUEST");
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new RegisteredAccountReconciliationError("INVALID_REQUEST");
  }
  const cursor = candidate as Record<string, unknown>;
  if (
    cursor.version !== 1 ||
    cursor.clerkInstanceId !== clerkInstanceId ||
    !Number.isSafeInteger(cursor.offset) ||
    (cursor.offset as number) < 0 ||
    (cursor.offset as number) > MAX_USERS
  ) {
    throw new RegisteredAccountReconciliationError("INVALID_REQUEST");
  }
  return cursor as unknown as ReconciliationCursor;
}

function validTimestamp(value: number): Date {
  const result = new Date(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(result.getTime())) {
    throw new RegisteredAccountReconciliationError();
  }
  return result;
}

function optionalTimestamp(value: number | null): Date | null {
  return value === null ? null : validTimestamp(value);
}

function cleanText(value: string | null, max: number): string | null {
  if (value === null) return null;
  const result = value.trim();
  if (!result) return null;
  if (result.length > max || result.includes("\u0000")) {
    throw new RegisteredAccountReconciliationError();
  }
  return result;
}

function snapshotFromProvider(
  user: ReconciliationProviderUser,
  clerkInstanceId: string,
  canonicalClerkUserId: string,
): ReconciliationSnapshot {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(user.id)) {
    throw new RegisteredAccountReconciliationError();
  }
  const primary = user.primaryEmailAddressId
    ? user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
    : undefined;
  const primaryEmail = primary
    ? (cleanText(primary.emailAddress, 320)?.toLowerCase() ?? null)
    : null;
  if (
    primaryEmail !== null &&
    (!primaryEmail.includes("@") || primaryEmail.startsWith("@") || primaryEmail.endsWith("@"))
  ) {
    throw new RegisteredAccountReconciliationError();
  }
  const firstName = cleanText(user.firstName, 80);
  const lastName = cleanText(user.lastName, 80);
  const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const updatedAt = validTimestamp(user.updatedAt);
  const audience =
    user.privateMetadata.skitzaAccountKind === "external" ||
    user.privateMetadata.skitzaAccountKind === "internal"
      ? user.privateMetadata.skitzaAccountKind
      : "unknown";
  const sourceId = `reconcile:sha256:${createHash("sha256")
    .update(`${clerkInstanceId}:${user.id}:${updatedAt.toISOString()}`)
    .digest("hex")}`;

  return {
    audienceType: audience,
    clerkUserId: canonicalClerkUserId,
    providerClerkUserId: user.id,
    clerkInstanceId,
    displayName: combinedName
      ? combinedName.slice(0, 160).trimEnd()
      : cleanText(user.username, 160),
    emailVerified: primary
      ? primary.verificationStatus === "verified"
        ? true
        : primary.verificationStatus === "unverified"
          ? false
          : null
      : null,
    lastSignInAt: optionalTimestamp(user.lastSignInAt),
    primaryEmail,
    providerCreatedAt: validTimestamp(user.createdAt),
    providerState: user.banned ? "banned" : user.locked ? "locked" : "active",
    providerUpdatedAt: updatedAt,
    sourceId,
  };
}

export function createClerkReconciliationProvider(
  secretKey: string,
): RegisteredAccountReconciliationProvider {
  const clerk = createClerkClient({ secretKey });
  return {
    async getInstanceId() {
      const instance = await clerk.instance.get();
      return instance.id;
    },
    async getPage(input) {
      const page = await clerk.users.getUserList(input);
      return {
        data: page.data.map((user) => ({
          banned: user.banned,
          createdAt: user.createdAt,
          emailAddresses: user.emailAddresses.map((email) => ({
            emailAddress: email.emailAddress,
            id: email.id,
            verificationStatus: email.verification?.status ?? null,
          })),
          firstName: user.firstName,
          id: user.id,
          lastName: user.lastName,
          lastSignInAt: user.lastSignInAt,
          locked: user.locked,
          primaryEmailAddressId: user.primaryEmailAddressId,
          privateMetadata: user.privateMetadata,
          updatedAt: user.updatedAt,
          username: user.username,
        })),
        totalCount: page.totalCount,
      };
    },
  };
}

export function createRegisteredAccountReconciliationRepository(
  db: Db,
  environment: FoundationEnvironment,
  now: () => Date = () => new Date(),
): RegisteredAccountReconciliationRepository {
  return {
    async applySnapshots(input) {
      return db.transaction(async (transaction) => {
        await purgeAdminHistoryInTransaction(transaction, environment);
        const audit = await recordAdminActionInTransaction(transaction, environment, input.audit);
        if (audit.replayed || input.snapshots.length === 0) {
          return { applied: 0, replayed: audit.replayed };
        }
        const syncedAt = now();
        const rows = await transaction
          .insert(registeredAccounts)
          .values(
            input.snapshots.map((snapshot) => ({
              audienceType: snapshot.audienceType,
              clerkUserId: snapshot.clerkUserId,
              providerClerkUserId: snapshot.providerClerkUserId,
              clerkInstanceId: snapshot.clerkInstanceId,
              displayName: snapshot.displayName,
              emailVerified: snapshot.emailVerified,
              lastSignInAt: snapshot.lastSignInAt,
              lastWebhookEventId: snapshot.sourceId,
              primaryEmail: snapshot.primaryEmail,
              providerCreatedAt: snapshot.providerCreatedAt,
              providerState: snapshot.providerState,
              providerUpdatedAt: snapshot.providerUpdatedAt,
              syncedAt,
              updatedAt: syncedAt,
            })),
          )
          .onConflictDoUpdate({
            target: registeredAccounts.clerkUserId,
            set: {
              audienceType: sql`excluded."audience_type"`,
              providerClerkUserId: sql`excluded."provider_clerk_user_id"`,
              clerkInstanceId: sql`excluded."clerk_instance_id"`,
              displayName: sql`excluded."display_name"`,
              emailVerified: sql`excluded."email_verified"`,
              lastSignInAt: sql`excluded."last_sign_in_at"`,
              lastWebhookEventId: sql`excluded."last_webhook_event_id"`,
              primaryEmail: sql`excluded."primary_email"`,
              providerCreatedAt: sql`excluded."provider_created_at"`,
              providerState: sql`excluded."provider_state"`,
              providerUpdatedAt: sql`excluded."provider_updated_at"`,
              syncedAt: sql`excluded."synced_at"`,
              updatedAt: sql`excluded."updated_at"`,
            },
            setWhere: sql`
              ${registeredAccounts.clerkInstanceId} IS DISTINCT FROM excluded."clerk_instance_id"
              OR (
                ${registeredAccounts.providerState} <> 'deleted'
                AND (
                  ${registeredAccounts.providerUpdatedAt} IS NULL
                  OR ${registeredAccounts.providerUpdatedAt} < excluded."provider_updated_at"
                  OR (
                    ${registeredAccounts.providerUpdatedAt} = excluded."provider_updated_at"
                    AND coalesce(${registeredAccounts.lastWebhookEventId}, '')
                      < excluded."last_webhook_event_id"
                  )
                )
              )
            `,
          })
          .returning({ clerkUserId: registeredAccounts.clerkUserId });
        return { applied: rows.length, replayed: false };
      });
    },
  };
}

export async function reconcileRegisteredAccounts(
  input: Readonly<{
    actorClerkUserId: string;
    clerkInstanceId: string;
    cursor?: string | null;
    environment: FoundationEnvironment;
    operationKey: string;
    provider: RegisteredAccountReconciliationProvider;
    repository: RegisteredAccountReconciliationRepository;
    identityResolver: RegisteredAccountReconciliationIdentityResolver;
    now?: () => Date;
  }>,
): Promise<
  Readonly<{
    applied: number;
    complete: boolean;
    durationMs: number;
    nextCursor: string | null;
    replayed: boolean;
    seen: number;
    skipped: number;
  }>
> {
  const clock = input.now ?? (() => new Date());
  const startedAt = clock();
  if (!Number.isFinite(startedAt.getTime())) {
    throw new RegisteredAccountReconciliationError();
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(input.clerkInstanceId)) {
    throw new RegisteredAccountReconciliationError();
  }
  // Admin authentication is provider-native and may belong to a different
  // Clerk instance than the selected Test/Live data environment. Preserve the
  // exact signed admin provider ID in this security audit; never resolve it
  // against the selected target provider by assumption.
  const actualInstanceId = await input.provider.getInstanceId();
  if (actualInstanceId !== input.clerkInstanceId) {
    throw new RegisteredAccountReconciliationError();
  }

  const offset = input.cursor
    ? decodeReconciliationCursor(input.cursor, input.clerkInstanceId).offset
    : 0;
  const page = await input.provider.getPage({ limit: PAGE_LIMIT, offset });
  if (
    !Number.isSafeInteger(page.totalCount) ||
    page.totalCount < 0 ||
    page.totalCount > MAX_USERS ||
    page.data.length > PAGE_LIMIT ||
    (page.data.length === 0 && offset < page.totalCount)
  ) {
    throw new RegisteredAccountReconciliationError();
  }
  const byId = new Map<string, ReconciliationSnapshot>();
  for (const user of page.data) {
    const providerClerkUserId = user.id;
    const canonicalClerkUserId = await input.identityResolver.resolveCanonicalUserId({
      clerkInstanceId: input.clerkInstanceId,
      providerClerkUserId,
    });
    const snapshot = snapshotFromProvider(user, input.clerkInstanceId, canonicalClerkUserId);
    const current = byId.get(snapshot.clerkUserId);
    if (!current || current.providerUpdatedAt < snapshot.providerUpdatedAt) {
      byId.set(snapshot.clerkUserId, snapshot);
    }
  }

  const snapshots = [...byId.values()];
  const batchDigest = canonicalFoundationDigest(
    snapshots
      .map((snapshot) => ({
        clerkUserId: snapshot.clerkUserId,
        sourceId: snapshot.sourceId,
      }))
      .sort((left, right) => left.clerkUserId.localeCompare(right.clerkUserId)),
  );
  const finishedAt = clock();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  const audit = buildRegisteredAccountsReconciliationCommand(
    {
      actorClerkUserId: input.actorClerkUserId,
      batchDigest,
      environment: input.environment,
      offset,
      operationKey: input.operationKey,
    },
    finishedAt,
  );
  const { applied, replayed } = await input.repository.applySnapshots({
    audit,
    snapshots,
  });
  const nextOffset = offset + page.data.length;
  const complete = page.data.length === 0 || nextOffset >= page.totalCount;
  return {
    applied,
    complete,
    durationMs,
    nextCursor: complete
      ? null
      : encodeReconciliationCursor({
          clerkInstanceId: input.clerkInstanceId,
          offset: nextOffset,
          version: 1,
        }),
    seen: snapshots.length,
    replayed,
    skipped: snapshots.length - applied,
  };
}
