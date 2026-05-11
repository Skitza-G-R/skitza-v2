import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

// Tranzila redirects the top-level browser window here on a successful
// charge (success_url in lib/tranzila.ts). We pass the bookingId
// through Tranzila's `pdesc` field because Tranzila mangles arbitrary
// querystring keys on the success redirect — `pdesc` is one of the
// fields it always echoes back verbatim.
//
// We confirm the booking via the public tRPC mutation, then bounce to
// /artist with a status flag. confirmAfterPayment is idempotent on
// already-confirmed rows so a refresh / duplicate-in-flight (the
// notify_url POST) is fine. The page is resilient: any failure logs
// and redirects to /artist rather than crashing or trampolining
// through another payment page.

type PageProps = {
  searchParams: Promise<{
    bookingId?: string;
    pdesc?: string;
    Response?: string;
  }>;
};

export default async function PaymentSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // pdesc is the canonical transport (Tranzila echoes it back); the
  // explicit `bookingId` param stays as a defensive fallback for
  // future routing changes.
  const bookingId = params.pdesc ?? params.bookingId ?? null;

  if (!bookingId) {
    console.error("[payment/success] missing bookingId", {
      bookingId,
      pdesc: params.pdesc,
      response: params.Response,
    });
    redirect("/artist?payment=failed");
  }

  let success = false;
  try {
    const caller = appRouter.createCaller({ userId: null });
    await caller.booking.confirmAfterPayment({ bookingId });
    success = true;
  } catch (err) {
    // Don't let a confirmation failure crash the page — log everything
    // useful for debugging and fall through to a safe redirect.
    console.error("[payment/success] failed", {
      bookingId,
      pdesc: params.pdesc,
      response: params.Response,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (success) {
    redirect("/artist?payment=success");
  }
  redirect("/artist");
}
