import { createDb, type FoundationEnvironment } from "@skitza/db";

import { createAdminDataFoundationRepository } from "./repository";
import { createAdminDataFoundation } from "./service";

export function createAdminDataFoundationRuntime(
  input: Readonly<{
    databaseUrl: string;
    environment: FoundationEnvironment;
  }>,
) {
  const db = createDb(input.databaseUrl);
  return createAdminDataFoundation(createAdminDataFoundationRepository(db, input.environment));
}
