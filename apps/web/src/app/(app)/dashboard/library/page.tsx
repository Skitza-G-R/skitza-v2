import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";

import { LibraryList } from "./library-list";

// Audio library — unified view of every trackVersion across every
// project owned by the caller. Server-fetches the list once, then hands
// to LibraryList for client-side filtering + side-panel interaction.
//
// Kept deliberately thin: the list lives in library.list (Phase G.3
// router), and the side panel loads its comments on demand via
// library.detail, so first paint is as small as possible.

export default async function LibraryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const rows = await caller.library.list();

  return (
    <AppShell active="music">
      <LibraryList initial={rows} />
    </AppShell>
  );
}
