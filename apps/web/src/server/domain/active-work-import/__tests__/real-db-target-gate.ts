const CURRENT_NEON_PROJECT_ID = "raspy-pine-96654399";
const FORBIDDEN_NEON_PROJECT_ID = "quiet-sun-92221754";
const TEST_BRANCH_NAME = "sk-255-test";

export const ACTIVE_WORK_IMPORT_REAL_DB_ENV = {
  databaseUrl: "SK255_TEST_DATABASE_URL",
  neonProjectId: "SK255_TEST_NEON_PROJECT_ID",
  neonBranchName: "SK255_TEST_NEON_BRANCH_NAME",
  targetConfirmation: "SK255_TEST_TARGET_CONFIRMATION",
} as const;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * A URL alone is never authority to write. The operator must independently
 * confirm the audited Neon project and the dedicated non-production branch.
 * Invalid supplied targeting fails loudly without returning or printing the
 * credential-bearing URL; an entirely absent URL simply skips the suite.
 */
export function confirmedActiveWorkImportTestDatabaseUrl(environment: Environment): string | null {
  const databaseUrl = environment[ACTIVE_WORK_IMPORT_REAL_DB_ENV.databaseUrl]?.trim();
  if (!databaseUrl) return null;
  const projectId = environment[ACTIVE_WORK_IMPORT_REAL_DB_ENV.neonProjectId]?.trim();
  const branchName = environment[ACTIVE_WORK_IMPORT_REAL_DB_ENV.neonBranchName]?.trim();
  const confirmation = environment[ACTIVE_WORK_IMPORT_REAL_DB_ENV.targetConfirmation]?.trim();
  if (
    environment.NODE_ENV?.trim() !== "test" ||
    projectId === FORBIDDEN_NEON_PROJECT_ID ||
    projectId !== CURRENT_NEON_PROJECT_ID ||
    branchName !== TEST_BRANCH_NAME ||
    confirmation !== "confirmed-development-test"
  ) {
    throw new Error("SK-255 database target is not the confirmed development/test branch");
  }
  try {
    const parsed = new URL(databaseUrl);
    if (
      (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
      !parsed.hostname ||
      !parsed.pathname ||
      parsed.pathname === "/"
    ) {
      throw new Error("invalid target");
    }
  } catch {
    throw new Error("SK-255 database target is not a valid Postgres endpoint");
  }
  return databaseUrl;
}
