import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { LegacyBookingPaymentUnavailable } from "~/components/artist/payment/legacy-booking-payment-unavailable";
import { legacyBookingPaymentState } from "~/server/payments/legacy-card-containment";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ bookingId: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export default async function PaymentPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { bookingId } = await params;
  const caller = appRouter.createCaller({ userId });

  let details: Awaited<ReturnType<typeof caller.payment.getPaymentDetails>>;
  try {
    details = await caller.payment.getPaymentDetails({ bookingId });
  } catch {
    redirect("/artist");
  }

  const paymentState = legacyBookingPaymentState(details.producerName);

  return (
    <LegacyBookingPaymentUnavailable
      title={paymentState.title}
      offAppInstructions={paymentState.offAppInstructions}
      safetyNotice={paymentState.safetyNotice}
      productName={details.product.name}
      producerName={details.producerName}
      amountCents={details.amountCents}
      currency={details.currency}
    />
  );
}
