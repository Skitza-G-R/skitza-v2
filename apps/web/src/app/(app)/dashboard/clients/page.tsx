import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

import { ClientsList } from "./clients-list";

// CRM landing. Server component — fetches the enriched list once on
// the server then hands off to ClientsList for interactive filtering,
// create/edit/delete, and the send-magic-link dialog.
//
// `listWithMeta` enriches each contact row with activeDealCount,
// totalDealCount, and lastActivity in a single extra SQL aggregate —
// no N+1. See clientContactsRouter.listWithMeta for the join logic.

export default async function ClientsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const rows = await caller.clientContacts.listWithMeta();

  // Narrow the serialized shape to plain JSON values — the client
  // receives Date objects via React's structured boundary, so we keep
  // them as-is. The list component normalizes into ISO strings where
  // needed.
  const initial = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    activeDealCount: r.activeDealCount,
    totalDealCount: r.totalDealCount,
    lastActivity: r.lastActivity,
  }));

  return (
    <AppShell active="clients">
      <ClientsList initial={initial} />
    </AppShell>
  );
}
