import { emailHashFor } from "~/server/artist/identity";

export type ClientManagementRecord = Readonly<{
  id: string;
  producerId: string;
  name: string;
  email: string;
  emailHash: string;
  phone: string | null;
  notes: string | null;
  tags: readonly string[];
  clerkUserId: string | null;
  invitedAt: Date | null;
  artistArchivedAt: Date | null;
  producerArchivedAt: Date | null;
}>;

export type ClientManagementEditPatch = Readonly<{
  name?: string;
  email?: string;
  emailHash?: string;
  phone?: string | null;
  notes?: string | null;
  tags?: readonly string[];
}>;

export type ClientManagementWriteResult =
  | Readonly<{ kind: "updated"; client: ClientManagementRecord }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "duplicate_email" }>;

export type ClientManagementTransaction = Readonly<{
  lockClient: (scope: {
    producerId: string;
    clientId: string;
  }) => Promise<ClientManagementRecord | null>;
  findClientByEmailHash: (scope: {
    producerId: string;
    emailHash: string;
  }) => Promise<ClientManagementRecord | null>;
  clientHasBlockingProject: (scope: {
    producerId: string;
    clientId: string;
  }) => Promise<boolean>;
  updateClient: (input: {
    producerId: string;
    clientId: string;
    patch: ClientManagementEditPatch;
  }) => Promise<ClientManagementWriteResult>;
  setProducerArchivedAt: (input: {
    producerId: string;
    clientId: string;
    producerArchivedAt: Date | null;
  }) => Promise<ClientManagementRecord | null>;
  setInvitedAt: (input: {
    producerId: string;
    clientId: string;
    invitedAt: Date;
  }) => Promise<ClientManagementRecord | null>;
}>;

export type ClientManagementAtomicScope = Readonly<{
  producerId: string;
  clientId: string;
  emailHash?: string;
}>;

export type ClientManagementRepository = Readonly<{
  atomically: <T>(
    scope: ClientManagementAtomicScope,
    work: (transaction: ClientManagementTransaction) => Promise<T>,
  ) => Promise<T>;
}>;

export type ClientManagementDomainErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DUPLICATE_EMAIL"
  | "BLOCKING_PROJECT";

export class ClientManagementDomainError extends Error {
  constructor(
    readonly code: ClientManagementDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClientManagementDomainError";
  }
}

export const CLIENT_ARCHIVE_BLOCKED_MESSAGE =
  "Complete or cancel active and waiting-for-payment projects before archiving this client.";

export type EditClientInput = Readonly<{
  producerId: string;
  clientId: string;
  name?: string;
  email?: string;
  phone?: string | null;
  notes?: string | null;
  tags?: readonly string[];
}>;

export type ClientManagementMutationResult = Readonly<{
  client: ClientManagementRecord;
  changed: boolean;
}>;

export type InviteClientInput = Readonly<{
  producerId: string;
  clientId: string;
  via: "email" | "link";
  invitedAt: Date;
  deliverEmail: (client: ClientManagementRecord) => Promise<void>;
}>;

export type InviteClientResult = Readonly<{
  invitedAt: Date;
  via: "email" | "link";
}>;

function requireIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new ClientManagementDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ClientManagementDomainError("INVALID_INPUT", `${label} must not be empty`);
  }
  return normalized;
}

function normalizeOptional(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeEmail(value: string): { email: string; emailHash: string } {
  const email = normalizeRequired(value, "Client email").toLowerCase();
  if (!email.includes("@")) {
    throw new ClientManagementDomainError("INVALID_INPUT", "Client email is invalid");
  }
  return { email, emailHash: emailHashFor(email) };
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const tag = normalizeRequired(raw, "Client tag");
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

function tagsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function notFound(): ClientManagementDomainError {
  return new ClientManagementDomainError("NOT_FOUND", "The client was not found");
}

function duplicateEmail(): ClientManagementDomainError {
  return new ClientManagementDomainError(
    "DUPLICATE_EMAIL",
    "A client with that email already exists.",
  );
}

/**
 * Commit the non-deletable invite intent under the same client lock used by
 * permanent deletion, then perform network delivery. This ordering guarantees
 * that an accepted email can never point at a subsequently deleted draft and
 * avoids holding a database connection during external I/O. A failed delivery
 * remains a pending invite and can be retried by the existing resend action.
 */
export async function inviteClient(
  repository: ClientManagementRepository,
  input: InviteClientInput,
): Promise<InviteClientResult> {
  requireIdentifier(input.producerId, "Producer id");
  requireIdentifier(input.clientId, "Client id");
  if (Number.isNaN(input.invitedAt.getTime())) {
    throw new ClientManagementDomainError("INVALID_INPUT", "Invite time must be valid");
  }

  const invitation = await repository.atomically(
    { producerId: input.producerId, clientId: input.clientId },
    async (transaction) => {
      const client = await transaction.lockClient({
        producerId: input.producerId,
        clientId: input.clientId,
      });
      if (!client || client.producerId !== input.producerId) throw notFound();

      const invitedAt = new Date(input.invitedAt);
      const updated = await transaction.setInvitedAt({
        producerId: input.producerId,
        clientId: input.clientId,
        invitedAt,
      });
      if (!updated) throw notFound();
      return { client: updated, invitedAt };
    },
  );

  if (input.via === "email") {
    await input.deliverEmail(invitation.client);
  }
  return { invitedAt: invitation.invitedAt, via: input.via };
}

export async function editClient(
  repository: ClientManagementRepository,
  input: EditClientInput,
): Promise<ClientManagementMutationResult> {
  requireIdentifier(input.producerId, "Producer id");
  requireIdentifier(input.clientId, "Client id");

  const normalizedName =
    input.name === undefined ? undefined : normalizeRequired(input.name, "Client name");
  const normalizedEmail = input.email === undefined ? undefined : normalizeEmail(input.email);
  const normalizedPhone =
    input.phone === undefined ? undefined : normalizeOptional(input.phone);
  const normalizedNotes =
    input.notes === undefined ? undefined : normalizeOptional(input.notes);
  const normalizedTags = input.tags === undefined ? undefined : normalizeTags(input.tags);

  const atomicScope: ClientManagementAtomicScope = {
    producerId: input.producerId,
    clientId: input.clientId,
    ...(normalizedEmail === undefined ? {} : { emailHash: normalizedEmail.emailHash }),
  };

  return repository.atomically(atomicScope, async (transaction) => {
    const client = await transaction.lockClient({
      producerId: input.producerId,
      clientId: input.clientId,
    });
    if (!client || client.producerId !== input.producerId) throw notFound();

    if (normalizedEmail && normalizedEmail.emailHash !== client.emailHash) {
      const duplicate = await transaction.findClientByEmailHash({
        producerId: input.producerId,
        emailHash: normalizedEmail.emailHash,
      });
      if (duplicate && duplicate.id !== client.id) throw duplicateEmail();
    }

    const patch: {
      name?: string;
      email?: string;
      emailHash?: string;
      phone?: string | null;
      notes?: string | null;
      tags?: readonly string[];
    } = {};
    if (normalizedName !== undefined && normalizedName !== client.name) {
      patch.name = normalizedName;
    }
    if (
      normalizedEmail !== undefined &&
      (normalizedEmail.email !== client.email || normalizedEmail.emailHash !== client.emailHash)
    ) {
      patch.email = normalizedEmail.email;
      patch.emailHash = normalizedEmail.emailHash;
    }
    if (normalizedPhone !== undefined && normalizedPhone !== client.phone) {
      patch.phone = normalizedPhone;
    }
    if (normalizedNotes !== undefined && normalizedNotes !== client.notes) {
      patch.notes = normalizedNotes;
    }
    if (normalizedTags !== undefined && !tagsEqual(normalizedTags, client.tags)) {
      patch.tags = normalizedTags;
    }

    if (Object.keys(patch).length === 0) return { client, changed: false };

    const result = await transaction.updateClient({
      producerId: input.producerId,
      clientId: input.clientId,
      patch,
    });
    if (result.kind === "duplicate_email") throw duplicateEmail();
    if (result.kind === "not_found") throw notFound();
    return { client: result.client, changed: true };
  });
}

export async function archiveClient(
  repository: ClientManagementRepository,
  input: Readonly<{ producerId: string; clientId: string; archivedAt: Date }>,
): Promise<ClientManagementMutationResult> {
  requireIdentifier(input.producerId, "Producer id");
  requireIdentifier(input.clientId, "Client id");
  if (Number.isNaN(input.archivedAt.getTime())) {
    throw new ClientManagementDomainError("INVALID_INPUT", "Archive time must be valid");
  }

  return repository.atomically(input, async (transaction) => {
    const client = await transaction.lockClient(input);
    if (!client || client.producerId !== input.producerId) throw notFound();
    if (client.producerArchivedAt !== null) return { client, changed: false };

    if (await transaction.clientHasBlockingProject(input)) {
      throw new ClientManagementDomainError(
        "BLOCKING_PROJECT",
        CLIENT_ARCHIVE_BLOCKED_MESSAGE,
      );
    }

    const updated = await transaction.setProducerArchivedAt({
      producerId: input.producerId,
      clientId: input.clientId,
      producerArchivedAt: new Date(input.archivedAt),
    });
    if (!updated) throw notFound();
    return { client: updated, changed: true };
  });
}

export async function restoreClient(
  repository: ClientManagementRepository,
  input: Readonly<{ producerId: string; clientId: string }>,
): Promise<ClientManagementMutationResult> {
  requireIdentifier(input.producerId, "Producer id");
  requireIdentifier(input.clientId, "Client id");

  return repository.atomically(input, async (transaction) => {
    const client = await transaction.lockClient(input);
    if (!client || client.producerId !== input.producerId) throw notFound();
    if (client.producerArchivedAt === null) return { client, changed: false };

    const updated = await transaction.setProducerArchivedAt({
      producerId: input.producerId,
      clientId: input.clientId,
      producerArchivedAt: null,
    });
    if (!updated) throw notFound();
    return { client: updated, changed: true };
  });
}
