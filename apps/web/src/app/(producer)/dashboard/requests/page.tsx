import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { PurchaseRequestsList } from "~/components/dashboard/requests/purchase-requests-list";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function PurchaseRequestsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const { requests } = await caller.producer.purchase.list({ status: "pending" });

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pt-6 pb-12 sm:px-6 sm:pt-10">
      <header className="mb-5 border-b border-[rgb(var(--border-subtle))] pb-5">
        <p className="font-mono text-[10px] font-semibold tracking-[0.15em] text-[rgb(var(--brand-primary-text))] uppercase">
          Purchase requests
        </p>
        <h1 className="font-display mt-2 text-3xl font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))] sm:text-4xl">
          Requests
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
          Review the price, payment choices, rights, and agreement the artist accepted before
          payment begins.
        </p>
      </header>

      <PurchaseRequestsList requests={requests} />
    </main>
  );
}
