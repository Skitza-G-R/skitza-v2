/**
 * Shared transaction-lock identity for every operation that can change the
 * relationship between a client archive state and project creation.
 */
export function clientAdvisoryLockKey(clientId: string): string {
  const normalized = clientId.trim();
  if (!normalized) throw new Error("Client id must not be empty");
  return `client:${normalized}`;
}
