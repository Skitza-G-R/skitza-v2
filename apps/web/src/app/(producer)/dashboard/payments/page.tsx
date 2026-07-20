import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { PaymentProofList } from "~/components/dashboard/payments/payment-proof-list";
import { ProofQueueRefresh } from "~/components/dashboard/payments/proof-queue-refresh";
import { appRouter } from "~/server/trpc/routers/_app";

export const metadata = { title: "Payments" };

/** Focused SK-75 surface: review work and immutable proof history only. */
export default async function PaymentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const caller = appRouter.createCaller({ userId });
  const [pending, history] = await Promise.all([
    caller.producer.purchase.proofOfPayment.pending(),
    caller.producer.purchase.proofOfPayment.history({ limit: 100 }),
  ]);
  const resolved = history.proofs.filter((proof) => proof.status !== "pending");

  return (
    <main className="mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-6 sm:py-9">
      <ProofQueueRefresh enabled={pending.proofs.length > 0} />
      <header className="mb-6">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
          Private off-app payments
        </p>
        <h1 className="font-display mt-2 text-[clamp(2rem,6vw,3.4rem)] leading-none font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Payments
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          Review artist evidence here. Requests remains only for new work decisions.
        </p>
      </header>
      <div className="space-y-6">
        <PaymentProofList
          title="Needs review"
          eyebrow={`${String(pending.proofs.length)} waiting`}
          proofs={pending.proofs}
          emptyCopy="No payment proofs need review."
        />
        <PaymentProofList
          title="Proof history"
          eyebrow="Immutable records"
          proofs={resolved}
          emptyCopy="Confirmed and rejected proofs will stay here."
        />
      </div>
    </main>
  );
}
