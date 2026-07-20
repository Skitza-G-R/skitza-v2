import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { toPaymentHistoryViewData } from "~/components/payments/payment-history-adapter";
import { PaymentHistoryView } from "~/components/payments/payment-history-view";
import { appRouter } from "~/server/trpc/routers/_app";

export const metadata = { title: "Payments" };

const SECTIONS = {
  waiting: {
    id: "waiting-for-payment",
    eyebrow: "Accepted purchases",
    title: "Waiting for payment",
    description: "Accepted work waiting for its required first payment or producer proof review.",
    emptyTitle: "Nothing is waiting",
    emptyDescription: "New accepted purchases will appear here when payment is needed.",
  },
  active: {
    id: "active-balances",
    eyebrow: "Active balances",
    title: "Balances and actions",
    description:
      "Your active purchases, upcoming schedule, current instructions, and next payment action.",
    emptyTitle: "No active balances",
    emptyDescription: "Active installment plans will appear here.",
  },
  history: {
    id: "artist-payment-history",
    eyebrow: "Immutable records",
    title: "History",
    description:
      "Paid and canceled purchases stay available with their accepted terms and payment history.",
    emptyTitle: "No payment history yet",
    emptyDescription: "Paid and canceled purchases will remain here.",
  },
} as const;

export default async function ArtistPaymentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const model = await appRouter.createCaller({ userId }).artist.purchase.payments();

  return (
    <main className="mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-6 sm:py-9">
      <header className="mb-7">
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--brand-primary-text))] uppercase">
          Your accepted work
        </p>
        <h1 className="font-display mt-2 text-[clamp(2rem,6vw,3.4rem)] leading-none font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Payments
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          See what is due, follow producer instructions, upload proof, and keep every accepted
          agreement and payment record.
        </p>
      </header>

      <div className="space-y-9">
        <PaymentHistoryView
          role="artist"
          data={toPaymentHistoryViewData(model.artistBuckets.waiting, SECTIONS.waiting, "artist")}
        />
        <PaymentHistoryView
          role="artist"
          data={toPaymentHistoryViewData(model.artistBuckets.active, SECTIONS.active, "artist")}
        />
        <PaymentHistoryView
          role="artist"
          data={toPaymentHistoryViewData(model.artistBuckets.history, SECTIONS.history, "artist")}
        />
      </div>
    </main>
  );
}
