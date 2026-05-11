import { redirect } from "next/navigation";

// Tranzila redirects the top-level browser window here on a successful
// charge (success_url in lib/tranzila.ts). This page is PURE UI — it
// does NOT call confirmAfterPayment. The authoritative confirmation
// happens server-to-server via /api/tranzila/callback (notify_url POST)
// so confirmAfterPayment runs at most once even if the artist refreshes
// the success page or arrives ahead of the POST.
//
// If the artist lands here before the notify POST has been processed,
// /artist will briefly still show the booking as pending — that's fine,
// the POST will catch up within seconds and the next render is correct.
//
// We accept `pdesc` (canonical — Tranzila echoes it back verbatim) and
// `bookingId` (defensive fallback) only for logging visibility; no DB
// work happens here.

type PageProps = {
  searchParams: Promise<{
    bookingId?: string;
    pdesc?: string;
    Response?: string;
  }>;
};

export default async function PaymentSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const bookingId = params.pdesc ?? params.bookingId ?? null;

  console.log("[payment/success]", {
    bookingId,
    pdesc: params.pdesc,
    response: params.Response,
  });

  if (!bookingId) {
    redirect("/artist?payment=failed");
  }
  redirect("/artist?payment=success");
}
