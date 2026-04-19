import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { NewContractShell } from "./new-contract-shell";

// Entry point for a fresh contract. Server component guards auth,
// client shell handles upload + createDraft + navigate.
export default async function NewContractPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return (
    <AppShell active="projects">
      <NewContractShell />
    </AppShell>
  );
}
