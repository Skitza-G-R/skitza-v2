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
    <div className="sk-page-enter mx-auto w-full max-w-[1040px] px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-10">
      <header className="mb-6">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--brand-primary))]">
          Gate 1 · purchase requests
        </p>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-4xl">
          Requests
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          Review what the artist agreed to before payment begins.
        </p>
      </header>

      <PurchaseRequestsList requests={requests} />
    </div>
  );
}
