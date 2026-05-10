import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { buildTranzilaRedirectUrl } from "~/lib/tranzila";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function PaymentPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { bookingId } = await params;
  const { error } = await searchParams;

  // Show an error landing page if Tranzila bounced the artist back here.
  // We deliberately don't auto-redirect to Tranzila again — the artist
  // clicks "Try again" to retry, which lands them back on this page
  // without the error param and triggers the redirect below.
  if (error === "payment_failed") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="text-lg font-medium text-[rgb(var(--fg-default))]">
          Payment failed. Please try again.
        </p>
        <a
          href={`/artist/payment/${bookingId}`}
          className="rounded-lg bg-[rgb(var(--brand-primary))] px-6 py-3 font-medium text-white"
        >
          Try again
        </a>
        <a
          href="/artist"
          className="text-sm text-[rgb(var(--fg-muted))] hover:underline"
        >
          Back to dashboard
        </a>
      </div>
    );
  }

  // Build the Tranzila URL and redirect the top-level browser. The
  // artist pays on Tranzila's domain, then Tranzila redirects them back
  // to /artist/payment/success (which confirms the booking).
  const caller = appRouter.createCaller({ userId });

  let details: Awaited<ReturnType<typeof caller.payment.getPaymentDetails>>;
  try {
    details = await caller.payment.getPaymentDetails({ bookingId });
  } catch {
    redirect("/artist");
  }

  // Per-producer Tranzila terminal — when set on the producer row, the
  // redirect points the artist at the producer's own terminal. Null falls
  // back to the master sandbox terminal in env (Phase 3 testing).
  const tranzilaUrl = buildTranzilaRedirectUrl({
    amountCents: details.amountCents,
    currency: details.currency,
    bookingId,
    artistEmail: details.booking.artistEmail,
    artistName: details.booking.artistName,
    productName: details.product.name,
    ...(details.producerTranzilaTerminalName
      ? { terminalName: details.producerTranzilaTerminalName }
      : {}),
  });

  redirect(tranzilaUrl);
}
