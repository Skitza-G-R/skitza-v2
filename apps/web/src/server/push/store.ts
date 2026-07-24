import { and, eq, lte, pushSubscriptions, type Db } from "@skitza/db";

import type { PushCategory } from "~/lib/push/categories";

import {
  PushEndpointOwnershipError,
  type OwnedSubscriptionClaim,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "./subscription-service";

type SubscriptionDb = Pick<Db, "delete" | "insert" | "select" | "transaction" | "update">;

function stored(row: typeof pushSubscriptions.$inferSelect): StoredPushSubscription {
  return {
    id: row.id,
    clerkUserId: row.clerkUserId,
    endpoint: row.endpoint,
    endpointHash: row.endpointHash,
    p256dh: row.p256dh,
    auth: row.auth,
    categories: row.categories as PushCategory[],
    expiresAt: row.expiresAt,
  };
}

export class DrizzlePushSubscriptionStore implements PushSubscriptionStore {
  constructor(private readonly db: SubscriptionDb) {}

  async claimOwned(input: OwnedSubscriptionClaim): Promise<StoredPushSubscription> {
    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpointHash, input.endpointHash))
        .limit(1);

      if (existing && existing.clerkUserId !== input.clerkUserId) {
        throw new PushEndpointOwnershipError();
      }

      if (existing) {
        const [updated] = await transaction
          .update(pushSubscriptions)
          .set({
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth,
            categories: [...input.categories],
            expiresAt: input.expiresAt,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(pushSubscriptions.id, existing.id),
              eq(pushSubscriptions.clerkUserId, input.clerkUserId),
            ),
          )
          .returning();
        if (!updated) throw new PushEndpointOwnershipError();
        return stored(updated);
      }

      const [inserted] = await transaction
        .insert(pushSubscriptions)
        .values({
          clerkUserId: input.clerkUserId,
          endpoint: input.endpoint,
          endpointHash: input.endpointHash,
          p256dh: input.p256dh,
          auth: input.auth,
          categories: [...input.categories],
          expiresAt: input.expiresAt,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: pushSubscriptions.endpointHash })
        .returning();
      if (inserted) return stored(inserted);

      const [winner] = await transaction
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpointHash, input.endpointHash))
        .limit(1);
      if (!winner || winner.clerkUserId !== input.clerkUserId) {
        throw new PushEndpointOwnershipError();
      }
      return stored(winner);
    });
  }

  async findByEndpointHash(endpointHash: string): Promise<StoredPushSubscription | null> {
    const [row] = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpointHash, endpointHash))
      .limit(1);
    return row ? stored(row) : null;
  }

  async listByOwner(clerkUserId: string): Promise<readonly StoredPushSubscription[]> {
    const rows = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.clerkUserId, clerkUserId));
    return rows.map(stored);
  }

  async deleteOwnedByHash(clerkUserId: string, endpointHash: string): Promise<boolean> {
    const rows = await this.db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.clerkUserId, clerkUserId),
          eq(pushSubscriptions.endpointHash, endpointHash),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return rows.length > 0;
  }

  async deleteOwnedById(clerkUserId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.clerkUserId, clerkUserId), eq(pushSubscriptions.id, id)))
      .returning({ id: pushSubscriptions.id });
    return rows.length > 0;
  }

  async deleteExpiredForOwner(clerkUserId: string, now: Date): Promise<number> {
    const rows = await this.db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.clerkUserId, clerkUserId), lte(pushSubscriptions.expiresAt, now)),
      )
      .returning({ id: pushSubscriptions.id });
    return rows.length;
  }
}
