import { syncBetaInviteeStatuses } from "@skitza/db";

import { BetaView } from "~/features/beta/beta-view";
import { serializeBetaInvitee } from "~/features/beta/view-model";
import { requireActiveAdminPage } from "~/server/auth/page-access";
import { createBetaRuntime } from "~/server/beta/runtime";

// SK-273 — founder Beta workspace. Statuses are refreshed from database
// truth (producers + projects) on every load, so the founder never has to
// press a sync button to see who signed up since the last visit.
export default async function AdminBetaPage() {
  await requireActiveAdminPage();
  const runtime = createBetaRuntime();
  await syncBetaInviteeStatuses(runtime.db, new Date());
  const invitees = await runtime.repository.listAll();

  return <BetaView invitees={invitees.map(serializeBetaInvitee)} />;
}
