import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { ContractsList, type ContractRow } from "./contracts-list";

// Contracts list — producer's dashboard index for the new PDF-editor
// contract flow. B.8 keeps this page deliberately simple: `contract.list()`
// returns a summary row per contract (no joins). Recipient counts are a
// later polish — the router either needs a dedicated listWithMeta() or
// the client can fold `detail()` N+1. Neither is worth it for MVP.
//
// TODO(contracts-v2): add caller.contract.listWithMeta() so the row can
// show "(X recipients)" without an N+1 storm.
export default async function ContractsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const rows = await caller.contract.list();

  // Drizzle returns Date objects for timestamps; serialise to ISO strings
  // so we can pass plain data across the server/client boundary without
  // Next's "Only plain objects" warning.
  const contracts: ContractRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <AppShell active="projects">
      <ContractsList contracts={contracts} />
    </AppShell>
  );
}
