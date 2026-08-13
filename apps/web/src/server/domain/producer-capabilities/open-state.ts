import { eq, producers, type Db } from "@skitza/db";

type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type LockedProducerCapabilityState = Readonly<{
  id: string;
  closedAt: Date | null;
}>;

/**
 * Serialize capability issuance/finalization with account closure.
 * Callers decide whether an exact completed replay may proceed after closure.
 */
export async function lockProducerCapabilityState(
  tx: TransactionDb,
  producerId: string,
): Promise<LockedProducerCapabilityState | null> {
  const [producer] = await tx
    .select({ id: producers.id, closedAt: producers.closedAt })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1)
    .for("update");
  return producer ?? null;
}
