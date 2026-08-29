import { createDb } from "@skitza/db";

import { HomeView } from "~/features/home/home-view";
import { buildHomeView } from "~/features/home/view-model";
import { requireActiveAdminPage } from "~/server/auth/page-access";
import { resolveAdminEnvironment } from "~/server/environment";
import { loadHomeSignals } from "~/server/home/queries";
import { createRegisteredUserRepository } from "~/server/registered-users/repository";

// SK-288 — the founder's first screen, rendered from database truth. The
// fixture overview it replaces invented every number on it.
export default async function AdminEnvironmentHomePage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  await requireActiveAdminPage();
  const { environment: rawEnvironment } = await params;
  const resolved = resolveAdminEnvironment(process.env, rawEnvironment);
  const db = createDb(resolved.databaseUrl);
  const signals = await loadHomeSignals(
    db,
    createRegisteredUserRepository(db, resolved.publicContext.id),
  );

  return <HomeView view={buildHomeView(signals)} />;
}
