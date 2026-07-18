import { and, clientContacts, eq, projects, sql, type Db } from "@skitza/db";

import type { StableProjectRepository } from "./service";

export function stableProjectRepository(
  db: Db,
): StableProjectRepository<typeof projects.$inferSelect> {
  return {
    atomically: (scope, work) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`client:${scope.clientContactId}`}, 0))`,
        );
        return work({
          lockClient: async (clientScope) => {
            const [client] = await tx
              .select({
                id: clientContacts.id,
                producerId: clientContacts.producerId,
                name: clientContacts.name,
                email: clientContacts.email,
              })
              .from(clientContacts)
              .where(
                and(
                  eq(clientContacts.id, clientScope.clientContactId),
                  eq(clientContacts.producerId, clientScope.producerId),
                ),
              )
              .limit(1)
              .for("update");
            return client ?? null;
          },
          insertProject: async (project) => {
            const [inserted] = await tx
              .insert(projects)
              .values(project)
              .returning();
            if (!inserted) {
              throw new Error("SKITZA_PROJECT_INSERT_FAILED");
            }
            return inserted;
          },
        });
      }),
  };
}
