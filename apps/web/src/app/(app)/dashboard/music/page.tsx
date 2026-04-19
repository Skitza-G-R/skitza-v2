import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { AppShell } from "~/components/shell/app-shell";

// Stub for the Music top-level tab. The sidebar's Music item points
// here (/dashboard/music), but the real Samply-style cross-project
// library is shipped by Task 10 of the 4-screen refactor. This stub
// exists solely so the sidebar click and the legacy
// /dashboard/library redirect don't 404 in the gap between Task 2
// (which kills /dashboard/library) and Task 10 (which replaces this
// page body). Delete-and-replace when Task 10 lands.
export default async function MusicStubPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <AppShell active="music">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <h1 className="font-display text-3xl tracking-tight">Music</h1>
        <p className="mt-4 text-[rgb(var(--fg-secondary))]">
          Your cross-project audio library is coming soon.
        </p>
      </div>
    </AppShell>
  );
}
