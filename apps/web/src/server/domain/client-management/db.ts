import { and, clientContacts, eq, inArray, projects, sql, type Db } from "@skitza/db";

import type {
  ClientManagementEditPatch,
  ClientManagementRecord,
  ClientManagementRepository,
} from "./service";
import { clientAdvisoryLockKey } from "./lock";

const CLIENT_EMAIL_UNIQUE_CONSTRAINT = "client_contacts_producer_email_unique";

function errorRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function isClientEmailUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const row = errorRecord(current);
    if (!row) break;
    const code = typeof row.code === "string" ? row.code : null;
    const constraint = typeof row.constraint === "string" ? row.constraint : null;
    const message =
      typeof row.message === "string"
        ? row.message
        : current instanceof Error
          ? current.message
          : "";
    if (
      (code === "23505" &&
        (constraint === CLIENT_EMAIL_UNIQUE_CONSTRAINT ||
          message.includes(CLIENT_EMAIL_UNIQUE_CONSTRAINT))) ||
      (message.includes(CLIENT_EMAIL_UNIQUE_CONSTRAINT) && /duplicate|unique/i.test(message))
    ) {
      return true;
    }
    current = row.cause;
  }
  return false;
}

function mutableEditPatch(patch: ClientManagementEditPatch): {
  name?: string;
  email?: string;
  emailHash?: string;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
} {
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.email === undefined ? {} : { email: patch.email }),
    ...(patch.emailHash === undefined ? {} : { emailHash: patch.emailHash }),
    ...(patch.phone === undefined ? {} : { phone: patch.phone }),
    ...(patch.notes === undefined ? {} : { notes: patch.notes }),
    ...(patch.tags === undefined ? {} : { tags: [...patch.tags] }),
  };
}

export function clientManagementRepository(db: Db): ClientManagementRepository {
  // Keep table-column access lazy. Several isolated router tests use a
  // deliberately partial @skitza/db mock and import this module without ever
  // constructing the repository.
  const clientSelection = {
    id: clientContacts.id,
    producerId: clientContacts.producerId,
    name: clientContacts.name,
    email: clientContacts.email,
    emailHash: clientContacts.emailHash,
    phone: clientContacts.phone,
    notes: clientContacts.notes,
    tags: clientContacts.tags,
    clerkUserId: clientContacts.clerkUserId,
    invitedAt: clientContacts.invitedAt,
    artistArchivedAt: clientContacts.archivedAt,
    producerArchivedAt: clientContacts.producerArchivedAt,
  };

  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        // This exact key is shared with stable project creation. Whichever
        // operation wins forces the other to re-read archive/project state.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${clientAdvisoryLockKey(scope.clientId)}, 0))`,
        );
        if (scope.emailHash !== undefined) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`client-email:${scope.producerId}:${scope.emailHash}`}, 0))`,
          );
        }

        return work({
          lockClient: async (clientScope) => {
            const [client] = await tx
              .select(clientSelection)
              .from(clientContacts)
              .where(
                and(
                  eq(clientContacts.id, clientScope.clientId),
                  eq(clientContacts.producerId, clientScope.producerId),
                ),
              )
              .limit(1)
              .for("update");
            return (client as ClientManagementRecord | undefined) ?? null;
          },
          findClientByEmailHash: async (emailScope) => {
            const [client] = await tx
              .select(clientSelection)
              .from(clientContacts)
              .where(
                and(
                  eq(clientContacts.producerId, emailScope.producerId),
                  eq(clientContacts.emailHash, emailScope.emailHash),
                ),
              )
              .limit(1);
            return (client as ClientManagementRecord | undefined) ?? null;
          },
          clientHasBlockingProject: async (clientScope) => {
            const [project] = await tx
              .select({ id: projects.id })
              .from(projects)
              .where(
                and(
                  eq(projects.producerId, clientScope.producerId),
                  eq(projects.clientContactId, clientScope.clientId),
                  inArray(projects.lifecycleStatus, ["active", "waiting_for_payment"]),
                ),
              )
              .limit(1);
            return project !== undefined;
          },
          updateClient: async (input) => {
            try {
              const [client] = await tx
                .update(clientContacts)
                .set(mutableEditPatch(input.patch))
                .where(
                  and(
                    eq(clientContacts.id, input.clientId),
                    eq(clientContacts.producerId, input.producerId),
                  ),
                )
                .returning(clientSelection);
              return client
                ? ({ kind: "updated", client } as const)
                : ({ kind: "not_found" } as const);
            } catch (error) {
              if (isClientEmailUniqueViolation(error)) {
                return { kind: "duplicate_email" } as const;
              }
              throw error;
            }
          },
          setProducerArchivedAt: async (input) => {
            const [client] = await tx
              .update(clientContacts)
              // Archive/restore deliberately changes this column only.
              .set({ producerArchivedAt: input.producerArchivedAt })
              .where(
                and(
                  eq(clientContacts.id, input.clientId),
                  eq(clientContacts.producerId, input.producerId),
                ),
              )
              .returning(clientSelection);
            return (client as ClientManagementRecord | undefined) ?? null;
          },
        });
      }),
  };
}
