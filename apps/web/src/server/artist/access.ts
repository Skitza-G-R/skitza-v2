import {
  and,
  clientContacts,
  eq,
  isNull,
  projects,
  sql,
  type Db,
} from "@skitza/db";
import { TRPCError } from "@trpc/server";

type SqlOperand = Parameters<typeof eq>[0];

type ArtistResourcePair = {
  producerId: SqlOperand;
  email: SqlOperand;
};

export function activeArtistClientPair(
  clerkUserId: string,
  resource: ArtistResourcePair,
) {
  return and(
    eq(clientContacts.clerkUserId, clerkUserId),
    eq(clientContacts.producerId, resource.producerId),
    eq(
      sql<string>`lower(${clientContacts.email})`,
      sql<string>`lower(${resource.email})`,
    ),
    isNull(clientContacts.archivedAt),
  );
}

export async function resolveProjectOwnership(
  db: Db,
  clerkUserId: string,
  projectId: string,
): Promise<{
  project: typeof projects.$inferSelect;
  contact: typeof clientContacts.$inferSelect;
}> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });

  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clerkUserId, clerkUserId),
        eq(clientContacts.producerId, project.producerId),
        eq(clientContacts.email, project.artistEmail.toLowerCase()),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

  return { project, contact };
}
