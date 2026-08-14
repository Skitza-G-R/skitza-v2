import { type Db, clerkUserSyncReceipts, eq, registeredAccounts, sql } from "@skitza/db";

export type RegisteredAccountProviderState = "active" | "banned" | "locked";
export type RegisteredAccountAudienceType = "external" | "internal" | "unknown";

export type RegisteredAccountProviderSnapshot = Readonly<{
  audienceType: RegisteredAccountAudienceType;
  clerkUserId: string;
  displayName: string | null;
  emailVerified: boolean | null;
  eventId: string;
  lastSignInAt: Date | null;
  primaryEmail: string | null;
  providerCreatedAt: Date;
  providerState: RegisteredAccountProviderState;
  providerUpdatedAt: Date;
}>;

export type RegisteredAccountSnapshot = RegisteredAccountProviderSnapshot &
  Readonly<{
    clerkInstanceId: string;
    providerClerkUserId: string;
  }>;

export type RegisteredAccountProviderTombstone = Readonly<{
  clerkUserId: string;
  eventId: string;
  providerUpdatedAt: Date;
}>;

export type RegisteredAccountTombstone = RegisteredAccountProviderTombstone &
  Readonly<{
    clerkInstanceId: string;
    providerClerkUserId: string;
  }>;

export type ParsedRegisteredAccountLifecycle =
  | Readonly<{
      eventType: "user.created" | "user.updated";
      instanceId: string;
      kind: "snapshot";
      snapshot: RegisteredAccountProviderSnapshot;
    }>
  | Readonly<{
      eventType: "user.deleted";
      instanceId: string;
      kind: "tombstone";
      tombstone: RegisteredAccountProviderTombstone;
    }>;

export type ClerkUserSyncReceiptInput = Readonly<{
  clerkInstanceId: string;
  canonicalClerkUserId: string;
  clerkUserId: string;
  eventDigest: string;
  eventId: string;
  eventType: "user.created" | "user.updated" | "user.deleted";
  providerUpdatedAt: Date;
}>;

export interface RegisteredAccountSyncRepository {
  readonly claimEvent: (
    receipt: ClerkUserSyncReceiptInput,
  ) => Promise<Readonly<{ replayed: boolean }>>;
  readonly upsertSnapshot: (
    snapshot: RegisteredAccountSnapshot,
  ) => Promise<Readonly<{ applied: boolean; terminalDeleted: boolean }>>;
  readonly tombstone: (
    tombstone: RegisteredAccountTombstone,
  ) => Promise<Readonly<{ applied: boolean }>>;
}

export class RegisteredAccountSyncError extends Error {
  constructor(message = "INVALID_CLERK_USER_EVENT") {
    super(message);
    this.name = "RegisteredAccountSyncError";
  }
}

export function shouldReplaceRegisteredAccountSnapshot(
  current: Readonly<{
    eventId: string | null;
    providerState: string;
    providerUpdatedAt: Date | null;
  }>,
  incoming: Readonly<{ eventId: string; providerUpdatedAt: Date }>,
): boolean {
  if (current.providerState === "deleted") return false;
  if (current.providerUpdatedAt === null) return true;
  const timeDifference = incoming.providerUpdatedAt.getTime() - current.providerUpdatedAt.getTime();
  if (timeDifference !== 0) return timeDifference > 0;
  return (current.eventId ?? "") < incoming.eventId;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function requiredIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) {
    throw new RegisteredAccountSyncError();
  }
  return value;
}

function requiredEventId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255) throw new RegisteredAccountSyncError();
  return trimmed;
}

function requiredDigest(value: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new RegisteredAccountSyncError();
  }
  return value;
}

function timestamp(value: unknown, required = false): Date | null {
  if (value === null || value === undefined) {
    if (required) throw new RegisteredAccountSyncError();
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RegisteredAccountSyncError();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new RegisteredAccountSyncError();
  return parsed;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new RegisteredAccountSyncError();
  return value;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new RegisteredAccountSyncError();
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength || trimmed.includes("\u0000")) {
    throw new RegisteredAccountSyncError();
  }
  return trimmed;
}

function displayName(data: UnknownRecord): string | null {
  const first = optionalText(data.first_name, 80);
  const last = optionalText(data.last_name, 80);
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined ? combined.slice(0, 160).trimEnd() : optionalText(data.username, 160);
}

function primaryEmail(data: UnknownRecord): Readonly<{
  address: string | null;
  verified: boolean | null;
}> {
  const primaryId = optionalText(data.primary_email_address_id, 200);
  if (!primaryId) return { address: null, verified: null };

  const values = Array.isArray(data.email_addresses) ? data.email_addresses : [];
  const selected = values
    .map(record)
    .filter((value): value is UnknownRecord => value !== null)
    .find((candidate) => candidate.id === primaryId);
  if (!selected) return { address: null, verified: null };

  const rawAddress = optionalText(selected.email_address, 320);
  if (!rawAddress) return { address: null, verified: null };
  const address = rawAddress.toLowerCase();
  if (!address.includes("@") || address.startsWith("@") || address.endsWith("@")) {
    throw new RegisteredAccountSyncError();
  }
  const verification = record(selected.verification);
  return {
    address,
    verified:
      verification?.status === "verified"
        ? true
        : verification?.status === "unverified"
          ? false
          : null,
  };
}

function audienceType(data: UnknownRecord): RegisteredAccountAudienceType {
  const privateMetadata = record(data.private_metadata);
  const value = privateMetadata?.skitzaAccountKind;
  if (value === "external" || value === "internal") return value;
  return "unknown";
}

function providerState(data: UnknownRecord): RegisteredAccountProviderState {
  const banned = requiredBoolean(data.banned);
  const locked = requiredBoolean(data.locked);
  if (banned) return "banned";
  if (locked) return "locked";
  return "active";
}

export function parseRegisteredAccountLifecycleEvent(
  value: unknown,
  webhookEventId: string,
  expectedClerkInstanceId: string,
): ParsedRegisteredAccountLifecycle | null {
  const event = record(value);
  if (!event || typeof event.type !== "string") {
    throw new RegisteredAccountSyncError();
  }
  if (
    event.type !== "user.created" &&
    event.type !== "user.updated" &&
    event.type !== "user.deleted"
  ) {
    return null;
  }

  const instanceId = requiredIdentifier(event.instance_id);
  if (instanceId !== requiredIdentifier(expectedClerkInstanceId)) {
    throw new RegisteredAccountSyncError("CLERK_INSTANCE_MISMATCH");
  }
  const data = record(event.data);
  if (!data) throw new RegisteredAccountSyncError();
  const clerkUserId = requiredIdentifier(data.id);
  const eventId = requiredEventId(webhookEventId);

  if (event.type === "user.deleted") {
    if (data.deleted !== true) throw new RegisteredAccountSyncError();
    return {
      eventType: event.type,
      instanceId,
      kind: "tombstone",
      tombstone: {
        clerkUserId,
        eventId,
        providerUpdatedAt: timestamp(event.timestamp, true) as Date,
      },
    };
  }

  const email = primaryEmail(data);
  if (event.type === "user.created" && email.address === null) {
    throw new RegisteredAccountSyncError();
  }

  return {
    eventType: event.type,
    instanceId,
    kind: "snapshot",
    snapshot: {
      audienceType: audienceType(data),
      clerkUserId,
      displayName: displayName(data),
      emailVerified: email.verified,
      eventId,
      lastSignInAt: timestamp(data.last_sign_in_at),
      primaryEmail: email.address,
      providerCreatedAt: timestamp(data.created_at, true) as Date,
      providerState: providerState(data),
      providerUpdatedAt: timestamp(data.updated_at, true) as Date,
    },
  };
}

export function createRegisteredAccountSyncRepository(
  db: Db,
  now: () => Date = () => new Date(),
): RegisteredAccountSyncRepository {
  return Object.freeze({
    async claimEvent(receipt: ClerkUserSyncReceiptInput) {
      const inserted = await db
        .insert(clerkUserSyncReceipts)
        .values(receipt)
        .onConflictDoNothing()
        .returning({ eventId: clerkUserSyncReceipts.eventId });
      if (inserted.length === 1) return { replayed: false };

      const [existing] = await db
        .select()
        .from(clerkUserSyncReceipts)
        .where(eq(clerkUserSyncReceipts.eventId, receipt.eventId))
        .limit(1);
      if (
        !existing ||
        existing.eventDigest !== receipt.eventDigest ||
        existing.eventType !== receipt.eventType ||
        existing.clerkUserId !== receipt.clerkUserId ||
        existing.canonicalClerkUserId !== receipt.canonicalClerkUserId ||
        existing.clerkInstanceId !== receipt.clerkInstanceId ||
        existing.providerUpdatedAt.getTime() !== receipt.providerUpdatedAt.getTime()
      ) {
        throw new RegisteredAccountSyncError("CLERK_EVENT_ID_CONFLICT");
      }
      return { replayed: true };
    },

    async upsertSnapshot(snapshot: RegisteredAccountSnapshot) {
      const syncedAt = now();
      const rows = await db
        .insert(registeredAccounts)
        .values({
          audienceType: snapshot.audienceType,
          clerkUserId: snapshot.clerkUserId,
          providerClerkUserId: snapshot.providerClerkUserId,
          clerkInstanceId: snapshot.clerkInstanceId,
          displayName: snapshot.displayName,
          emailVerified: snapshot.emailVerified,
          lastSignInAt: snapshot.lastSignInAt,
          lastWebhookEventId: snapshot.eventId,
          primaryEmail: snapshot.primaryEmail,
          providerCreatedAt: snapshot.providerCreatedAt,
          providerState: snapshot.providerState,
          providerUpdatedAt: snapshot.providerUpdatedAt,
          syncedAt,
          updatedAt: syncedAt,
        })
        .onConflictDoUpdate({
          target: registeredAccounts.clerkUserId,
          set: {
            audienceType: snapshot.audienceType,
            providerClerkUserId: snapshot.providerClerkUserId,
            clerkInstanceId: snapshot.clerkInstanceId,
            displayName: snapshot.displayName,
            emailVerified: snapshot.emailVerified,
            lastSignInAt: snapshot.lastSignInAt,
            lastWebhookEventId: snapshot.eventId,
            primaryEmail: snapshot.primaryEmail,
            providerCreatedAt: snapshot.providerCreatedAt,
            providerState: snapshot.providerState,
            providerUpdatedAt: snapshot.providerUpdatedAt,
            syncedAt,
            updatedAt: syncedAt,
          },
          setWhere: sql`
            ${registeredAccounts.clerkInstanceId} IS DISTINCT FROM ${snapshot.clerkInstanceId}
            OR (
              ${registeredAccounts.providerState} <> 'deleted'
              AND (
                ${registeredAccounts.providerUpdatedAt} IS NULL
                OR ${registeredAccounts.providerUpdatedAt} < ${snapshot.providerUpdatedAt}
                OR (
                  ${registeredAccounts.providerUpdatedAt} = ${snapshot.providerUpdatedAt}
                  AND coalesce(${registeredAccounts.lastWebhookEventId}, '')
                    < ${snapshot.eventId}
                )
              )
            )
          `,
        })
        .returning({ clerkUserId: registeredAccounts.clerkUserId });
      if (rows.length === 1) return { applied: true, terminalDeleted: false };
      const [current] = await db
        .select({ providerState: registeredAccounts.providerState })
        .from(registeredAccounts)
        .where(eq(registeredAccounts.clerkUserId, snapshot.clerkUserId))
        .limit(1);
      return {
        applied: false,
        terminalDeleted: current?.providerState === "deleted",
      };
    },

    async tombstone(tombstone: RegisteredAccountTombstone) {
      const syncedAt = now();
      const rows = await db
        .insert(registeredAccounts)
        .values({
          audienceType: "unknown",
          clerkUserId: tombstone.clerkUserId,
          providerClerkUserId: tombstone.providerClerkUserId,
          clerkInstanceId: tombstone.clerkInstanceId,
          displayName: null,
          emailVerified: null,
          lastSignInAt: null,
          lastWebhookEventId: tombstone.eventId,
          primaryEmail: null,
          providerState: "deleted",
          providerUpdatedAt: tombstone.providerUpdatedAt,
          syncedAt,
          updatedAt: syncedAt,
        })
        .onConflictDoUpdate({
          target: registeredAccounts.clerkUserId,
          set: {
            audienceType: "unknown",
            providerClerkUserId: tombstone.providerClerkUserId,
            clerkInstanceId: tombstone.clerkInstanceId,
            displayName: null,
            emailVerified: null,
            lastSignInAt: null,
            lastWebhookEventId: tombstone.eventId,
            primaryEmail: null,
            providerState: "deleted",
            providerUpdatedAt: tombstone.providerUpdatedAt,
            syncedAt,
            updatedAt: syncedAt,
          },
          setWhere: sql`
            ${registeredAccounts.clerkInstanceId} IS DISTINCT FROM ${tombstone.clerkInstanceId}
            OR ${registeredAccounts.providerUpdatedAt} IS NULL
            OR ${registeredAccounts.providerUpdatedAt} <= ${tombstone.providerUpdatedAt}
          `,
        })
        .returning({ clerkUserId: registeredAccounts.clerkUserId });
      return { applied: rows.length === 1 };
    },
  });
}

export async function synchronizeRegisteredAccount(
  repository: RegisteredAccountSyncRepository,
  event: unknown,
  webhookEventId: string,
  eventDigest: string,
  expectedClerkInstanceId: string,
  resolveCanonicalUserId: (
    input: Readonly<{
      clerkInstanceId: string;
      providerClerkUserId: string;
    }>,
  ) => Promise<string>,
): Promise<
  Readonly<{
    lifecycle: ParsedRegisteredAccountLifecycle | null;
    replayed: boolean;
    terminalDeleted: boolean;
  }>
> {
  const parsed = parseRegisteredAccountLifecycleEvent(
    event,
    webhookEventId,
    expectedClerkInstanceId,
  );
  if (!parsed) {
    return { lifecycle: null, replayed: false, terminalDeleted: false };
  }

  const providerUpdatedAt =
    parsed.kind === "snapshot"
      ? parsed.snapshot.providerUpdatedAt
      : parsed.tombstone.providerUpdatedAt;
  const providerClerkUserId =
    parsed.kind === "snapshot" ? parsed.snapshot.clerkUserId : parsed.tombstone.clerkUserId;
  const canonicalClerkUserId = await resolveCanonicalUserId({
    clerkInstanceId: parsed.instanceId,
    providerClerkUserId,
  });
  const claimed = await repository.claimEvent({
    clerkInstanceId: parsed.instanceId,
    canonicalClerkUserId,
    clerkUserId: providerClerkUserId,
    eventDigest: requiredDigest(eventDigest),
    eventId: webhookEventId,
    eventType: parsed.eventType,
    providerUpdatedAt,
  });
  if (claimed.replayed) {
    return { lifecycle: parsed, replayed: true, terminalDeleted: false };
  }

  if (parsed.kind === "snapshot") {
    const result = await repository.upsertSnapshot({
      ...parsed.snapshot,
      clerkInstanceId: parsed.instanceId,
      clerkUserId: canonicalClerkUserId,
      providerClerkUserId,
    });
    return {
      lifecycle: parsed,
      replayed: false,
      terminalDeleted: result.terminalDeleted,
    };
  } else {
    await repository.tombstone({
      ...parsed.tombstone,
      clerkInstanceId: parsed.instanceId,
      clerkUserId: canonicalClerkUserId,
      providerClerkUserId,
    });
  }
  return { lifecycle: parsed, replayed: false, terminalDeleted: false };
}
