import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";

import { ArtistPaymentsOverview } from "~/components/artist/payments/artist-payments-overview";
import { toPaymentHistoryViewData } from "~/components/payments/payment-history-adapter";
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
  const sections = [
    toPaymentHistoryViewData(model.artistBuckets.waiting, SECTIONS.waiting, "artist"),
    toPaymentHistoryViewData(model.artistBuckets.active, SECTIONS.active, "artist"),
    toPaymentHistoryViewData(model.artistBuckets.history, SECTIONS.history, "artist"),
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <header className="mb-7 max-w-[620px]">
        <h1 className="font-display text-[clamp(1.9rem,6vw,2.8rem)] leading-none font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Payments
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          See what is due, pay your studio directly, and keep every proof and verification record.
        </p>
      </header>

      <ArtistPaymentsOverview sections={sections} />
    </div>
  );
}
