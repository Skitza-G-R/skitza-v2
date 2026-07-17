import { and, clientContacts, eq, isNull, projects, sql, type Db } from "@skitza/db";
import { TRPCError } from "@trpc/server";

type SqlOperand = Parameters<typeof eq>[0];

type ArtistResourcePair = {
  producerId: SqlOperand;
  email: SqlOperand;
};

type ArtistOwnedResource = {
  producerId: SqlOperand;
  clientContactId: SqlOperand;
};

export function activeArtistClientPair(clerkUserId: string, resource: ArtistResourcePair) {
  return and(
    eq(clientContacts.clerkUserId, clerkUserId),
    eq(clientContacts.producerId, resource.producerId),
    eq(sql<string>`lower(${clientContacts.email})`, sql<string>`lower(${resource.email})`),
    isNull(clientContacts.archivedAt),
  );
}

/**
 * Stable-ID ownership boundary for redesigned resources. Email is mutable
 * profile data and must never grant or transfer access to purchase-owned work.
 */
export function activeArtistClientOwner(clerkUserId: string, resource: ArtistOwnedResource) {
  return and(
    eq(clientContacts.clerkUserId, clerkUserId),
    eq(clientContacts.id, resource.clientContactId),
    eq(clientContacts.producerId, resource.producerId),
    isNull(clientContacts.archivedAt),
  );
}

export function assertArtistMusicProjectAvailable(
  lifecycleStatus: (typeof projects.$inferSelect)["lifecycleStatus"],
): void {
  if (lifecycleStatus === "waiting_for_payment") {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

export async function resolveProjectOwnership(
  db: Db,
  clerkUserId: string,
  projectId: string,
): Promise<{
  project: typeof projects.$inferSelect;
  contact: typeof clientContacts.$inferSelect;
}> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });

  const [contact] = await db
    .select()
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.clerkUserId, clerkUserId),
        eq(clientContacts.id, project.clientContactId),
        eq(clientContacts.producerId, project.producerId),
        isNull(clientContacts.archivedAt),
      ),
    )
    .limit(1);
  if (!contact) throw new TRPCError({ code: "NOT_FOUND" });

  return { project, contact };
}
