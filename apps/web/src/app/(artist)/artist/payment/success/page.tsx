import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila redirects the top-level browser window here on a successful
// charge (success_url in lib/tranzila.ts). We confirm the booking via
// the public mutation, then bounce to /artist with a status flag.
// confirmAfterPayment is idempotent on already-confirmed rows so a
// refresh / duplicate-in-flight (with the notify_url POST) is fine.

type PageProps = {
  searchParams: Promise<{ bookingId?: string }>;
};

export default async function PaymentSuccessPage({ searchParams }: PageProps) {
  const { bookingId } = await searchParams;
  if (!bookingId) {
    redirect("/artist?payment=failed");
  }

  let success = false;
  try {
    const caller = appRouter.createCaller({ userId: null });
    await caller.booking.confirmAfterPayment({ bookingId });
    success = true;
  } catch (err) {
    console.error("[payment-success] confirmAfterPayment failed", err);
  }

  if (success) {
    redirect("/artist?payment=success");
  }
  redirect(`/artist/payment/${bookingId}?error=payment_failed`);
}
