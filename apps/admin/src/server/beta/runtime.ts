import { createDb, type Db } from "@skitza/db";

import { resolveAdminEnvironment, type AdminEnvironmentId } from "~/server/environment";
import { createBetaRepository, type BetaRepository } from "./repository";

// SK-273 — resolves one explicit admin environment (live/test) into the Beta
// page's working set, mirroring registered-users/runtime.ts. The databaseUrl
// is exposed for the release route's per-email advisory locks.

export function createBetaRuntime(): Readonly<{
  databaseUrl: string;
  db: Db;
  environment: AdminEnvironmentId;
  repository: BetaRepository;
}> {
  const resolved = resolveAdminEnvironment(process.env);
  const db = createDb(resolved.databaseUrl);
  return {
    databaseUrl: resolved.databaseUrl,
    db,
    environment: resolved.publicContext.id,
    repository: createBetaRepository(db),
  };
}
