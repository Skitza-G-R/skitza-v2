import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { PendingPaymentProofs } from "~/components/dashboard/requests/pending-payment-proofs";
import { ProofQueueRefresh } from "~/components/dashboard/requests/proof-queue-refresh";
import { PurchaseRequestsList } from "~/components/dashboard/requests/purchase-requests-list";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function PurchaseRequestsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [{ requests }, pendingPaymentProofs] = await Promise.all([
    caller.producer.purchase.list({ status: "pending" }),
    caller.producer.purchase.proofOfPayment.pending(),
  ]);

  return (
    <div className="sk-page-enter mx-auto w-full max-w-[1040px] px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-10">
      <ProofQueueRefresh />
      <header className="mb-6">
        <p className="font-mono text-[10px] font-bold tracking-widest text-[rgb(var(--brand-primary))] uppercase">
          Purchases · Gate 1 + Gate 2
        </p>
        <h1 className="font-display mt-2 text-3xl font-extrabold tracking-[-0.03em] text-[rgb(var(--fg-default))] sm:text-4xl">
          Requests
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          Review purchase terms before payment, then verify private payment evidence when it
          arrives.
        </p>
      </header>

      <div className="space-y-6">
        {pendingPaymentProofs.available ? (
          <PendingPaymentProofs proofs={pendingPaymentProofs.proofs} />
        ) : null}
        <PurchaseRequestsList requests={requests} />
      </div>
    </div>
  );
}
