import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ProofQueueRefresh } from "~/components/dashboard/payments/proof-queue-refresh";
import { ProducerPaymentsDashboard } from "~/components/payments/producer-payments-dashboard";
import { toProducerPaymentsDashboardData } from "~/components/payments/producer-payments-dashboard-data";
import { producerPaymentProofQueueVersion } from "~/server/runtime/queue-version";
import { appRouter } from "~/server/trpc/routers/_app";

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const caller = appRouter.createCaller({ userId });
  const initialNowIso = new Date().toISOString();
  const [model, producer] = await Promise.all([
    caller.purchaseLedger.overview(),
    caller.producer.me(),
  ]);
  const dashboardData = toProducerPaymentsDashboardData(model);
  const pendingProofIds = model.projects.flatMap((project) =>
    project.purchases.flatMap((purchase) =>
      purchase.proofs.filter((proof) => proof.status === "pending").map((proof) => proof.id),
    ),
  );

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 py-5 pb-28 sm:px-6 sm:py-8 lg:pb-10">
      <ProofQueueRefresh
        kind="payment-proofs"
        initialVersion={producerPaymentProofQueueVersion(pendingProofIds)}
      />
      <header className="mb-5">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
          Money dashboard
        </p>
        <h1 className="font-display mt-1.5 text-[clamp(2rem,6vw,3.15rem)] leading-none font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Payments
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          See what came in, what is due, and what is still waiting on the work.
        </p>
      </header>

      <ProducerPaymentsDashboard
        data={dashboardData}
        producerTimeZone={producer.timezone || "UTC"}
        initialNowIso={initialNowIso}
      />
    </main>
  );
}
