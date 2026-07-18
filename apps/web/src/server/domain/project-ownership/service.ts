export type StableClientRecord = Readonly<{
  id: string;
  producerId: string;
  name: string;
  email: string;
}>;

export type StableProjectInsert = Readonly<{
  producerId: string;
  clientContactId: string;
  title: string;
  clientName: string;
  clientEmail: string;
  artistName: string;
  artistEmail: string;
  inviteToken: string;
  deadlineAt: Date | null;
}>;

export type StableProjectRecord = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  title: string;
  clientName: string | null;
  clientEmail: string | null;
  artistName: string;
  artistEmail: string;
  inviteToken: string | null;
  deadlineAt: Date | null;
}>;

export type StableProjectTransaction<TProject extends StableProjectRecord> = Readonly<{
  lockClient: (scope: {
    producerId: string;
    clientContactId: string;
  }) => Promise<StableClientRecord | null>;
  insertProject: (input: StableProjectInsert) => Promise<TProject>;
}>;

export type StableProjectRepository<
  TProject extends StableProjectRecord = StableProjectRecord,
> = Readonly<{
  atomically: <T>(
    scope: { producerId: string; clientContactId: string },
    work: (transaction: StableProjectTransaction<TProject>) => Promise<T>,
  ) => Promise<T>;
}>;

export class ProjectOwnershipDomainError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "OWNER_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ProjectOwnershipDomainError";
  }
}

/**
 * A verified account may claim an unowned client once. An email edit or a
 * later join attempt can never replace the stable account owner.
 */
export function assertStableArtistOwnerAssignment(
  existingClerkUserId: string | null,
  requestedClerkUserId: string,
): string {
  if (existingClerkUserId === null || existingClerkUserId === requestedClerkUserId) {
    return requestedClerkUserId;
  }
  throw new ProjectOwnershipDomainError(
    "OWNER_CONFLICT",
    "This client already belongs to another verified account",
  );
}

/**
 * Creates a project only after locking the exact producer/client pair. Email
 * and name are copied for display, but the immutable client id is the owner.
 */
export async function createStableClientProject<TProject extends StableProjectRecord>(
  repository: StableProjectRepository<TProject>,
  input: Readonly<{
    producerId: string;
    clientContactId: string;
    title: string;
    inviteToken: string;
    deadlineAt: Date | null;
  }>,
): Promise<TProject> {
  return repository.atomically(input, async (transaction) => {
    const client = await transaction.lockClient({
      producerId: input.producerId,
      clientContactId: input.clientContactId,
    });
    if (!client || client.producerId !== input.producerId) {
      throw new ProjectOwnershipDomainError("NOT_FOUND", "The client was not found");
    }

    return transaction.insertProject({
      producerId: input.producerId,
      clientContactId: client.id,
      title: input.title,
      clientName: client.name,
      clientEmail: client.email,
      artistName: client.name,
      artistEmail: client.email,
      inviteToken: input.inviteToken,
      deadlineAt: input.deadlineAt,
    });
  });
}
