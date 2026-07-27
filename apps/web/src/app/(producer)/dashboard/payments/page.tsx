import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ProofQueueRefresh } from "~/components/dashboard/payments/proof-queue-refresh";
import { ProducerPaymentWorkspace } from "~/components/payments/producer-payment-workspace";
import { toProducerPaymentWorkspaceBuckets } from "~/components/payments/producer-payment-workspace-data";
import { appRouter } from "~/server/trpc/routers/_app";

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const model = await appRouter.createCaller({ userId }).purchaseLedger.overview();
  const workspaceBuckets = toProducerPaymentWorkspaceBuckets(model.producerBuckets);

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 sm:py-9">
      <ProofQueueRefresh enabled={model.producerBuckets.needs_review.projects.length > 0} />
      <header className="mb-7">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
          Money workspace
        </p>
        <h1 className="font-display mt-2 text-[clamp(2rem,6vw,3.4rem)] leading-none font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Payments
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          See what needs attention, then filter by client, project, status, or currency. Every
          balance stays attached to its accepted purchase.
        </p>
      </header>

      <ProducerPaymentWorkspace buckets={workspaceBuckets} scope="global" defaultView="open" />
    </main>
  );
}
