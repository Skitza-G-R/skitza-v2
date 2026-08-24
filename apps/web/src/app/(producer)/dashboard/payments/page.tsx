import { auth } from "~/server/auth/clerk-identity";
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
    <main className="mx-auto w-full max-w-[1320px] px-4 py-3 pb-28 sm:px-6 sm:py-5 lg:pb-10">
      <ProofQueueRefresh
        kind="payment-proofs"
        initialVersion={producerPaymentProofQueueVersion(pendingProofIds)}
      />
      {/* SK-275 — the page title now sits on the dashboard's own control line. */}
      <ProducerPaymentsDashboard
        data={dashboardData}
        producerTimeZone={producer.timezone || "UTC"}
        initialNowIso={initialNowIso}
      />
    </main>
  );
}
