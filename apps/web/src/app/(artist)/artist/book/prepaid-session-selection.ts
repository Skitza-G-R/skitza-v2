export type PrepaidSessionIdentity = Readonly<{
  projectId: string;
  purchaseId: string;
  sessionAllowanceId: string;
}>;

export function findPrepaidSessionByAllowance<
  T extends PrepaidSessionIdentity,
>(rows: readonly T[], sessionAllowanceId: string | null): T | null {
  if (!sessionAllowanceId) return null;
  return rows.find((row) => row.sessionAllowanceId === sessionAllowanceId) ?? null;
}

export function uniquePrepaidSessionForProject<
  T extends PrepaidSessionIdentity,
>(rows: readonly T[], projectId: string | null): T | null {
  if (!projectId) return null;
  const matches = rows.filter((row) => row.projectId === projectId);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
