import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

import { ClientTimeline } from "./client-timeline";

type PageProps = { params: Promise<{ id: string }> };

// Per-client detail view. Loads contact + projects + contracts +
// recent comments in a single tRPC round-trip (detail() joins under
// the hood) and hands off to the client component for interactive
// controls.

export default async function ClientDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;

  const caller = appRouter.createCaller({ userId });
  let data: Awaited<ReturnType<typeof caller.clientContacts.detail>>;
  try {
    data = await caller.clientContacts.detail({ id });
  } catch {
    notFound();
  }

  return (
    <AppShell active="today">
      <ClientTimeline
        contact={data.contact}
        stats={data.stats}
        projects={data.projects}
        contracts={data.contracts}
        comments={data.comments}
      />
    </AppShell>
  );
}
