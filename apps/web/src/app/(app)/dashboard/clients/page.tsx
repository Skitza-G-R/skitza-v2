import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

import { ClientsHub } from "./clients-list";

// CRM hub landing — Phase H.2. Fetches both views in parallel on the
// server so toggling between "By Client" and "All Projects" is an
// instant client-side switch with no further round-trips. Filter state
// (search, status, stage, sort) is then maintained purely on the client
// via URL query params; refreshing the page preserves the filters.

export default async function ClientsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [byClient, allProjects] = await Promise.all([
    caller.clientContacts.listWithProjects({ view: "by-client" }),
    caller.clientContacts.listWithProjects({ view: "all-projects" }),
  ]);

  // Narrow to serialisable plain objects — Next passes these via the
  // RSC boundary so Date instances remain wire-safe as ISO strings.
  return (
    <AppShell active="today">
      <ClientsHub
        initialClients={byClient.view === "by-client" ? byClient.clients : []}
        initialProjects={
          allProjects.view === "all-projects" ? allProjects.projects : []
        }
      />
    </AppShell>
  );
}
